import { Socket } from 'socket.io-client';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import axios from 'axios';
import execa from 'execa';
import FormData from 'form-data';
import { pipeline } from 'stream/promises';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

interface DeviceMetadata {
    width: number;
    height: number;
    rotation: number;
    lastUpdated: number;
}

export class AdbManager {
    private socket: Socket;
    private agentId: string;
    private metadataCache = new Map<string, DeviceMetadata>();

    constructor(socket: Socket, agentId: string) {
        this.socket = socket;
        this.agentId = agentId;
    }

    async getMetadata(deviceId: string, force = false): Promise<DeviceMetadata | null> {
        const cached = this.metadataCache.get(deviceId);
        const now = Date.now();
        // Reduce cache TTL to 2s
        if (!force && cached && (now - cached.lastUpdated < 2000)) {
            return cached;
        }

        try {
            const { stdout: dispStdout } = await execa('adb', ['-s', deviceId, 'shell', 'dumpsys display']);

            const overrideIdx = dispStdout.indexOf('mOverrideDisplayInfo');
            let width = 0, height = 0, rotation = 0;

            if (overrideIdx !== -1) {
                const block = dispStdout.slice(overrideIdx, overrideIdx + 2000);
                const realMatch = block.match(/real (\d+) x (\d+)/);
                const rotMatch = block.match(/rotation (\d)/);
                if (realMatch) {
                    width = parseInt(realMatch[1]);
                    height = parseInt(realMatch[2]);
                }
                if (rotMatch) {
                    rotation = parseInt(rotMatch[1]);
                } else if (width && height) {
                    rotation = width > height ? 1 : 0;
                }
            }

            if (!width || !height) {
                const { stdout: sizeStdout } = await execa('adb', ['-s', deviceId, 'shell', 'wm', 'size']);
                const overrideMatch = sizeStdout.match(/Override size: (\d+)x(\d+)/);
                const physicalMatch = sizeStdout.match(/Physical size: (\d+)x(\d+)/);
                const data = overrideMatch || physicalMatch;
                if (data) {
                    width = Number(data[1]);
                    height = Number(data[2]);
                }
            }

            if (!width || !height) return null;

            const metadata = { width, height, rotation, lastUpdated: now };
            this.metadataCache.set(deviceId, metadata);
            console.log(`[Agent] Metadata refreshed for ${deviceId}: ${width}x${height} rot=${rotation}`);
            return metadata;
        } catch (e) {
            console.error(`[Agent] Failed to fetch metadata for ${deviceId}:`, e);
            return null;
        }
    }

    setupHandlers() {
        this.socket.on('adb_push', async (data: { deviceId: string, fileId: string, filename: string }) => {
            console.log('[Agent] adb_push received:', data);
            const { deviceId, fileId, filename } = data;
            const tempPath = path.join(os.tmpdir(), `adb-push-${Date.now()}-${filename}`);

            try {
                const downloadUrl = `${SERVER_URL}/api/download/${fileId}`;
                const writer = fs.createWriteStream(tempPath);
                const response = await axios.get(downloadUrl, { responseType: 'stream' });
                await pipeline(response.data as any, writer);

                console.log(`[Agent] Pushing ${tempPath} to /sdcard/Download/${filename}`);
                await execa('adb', ['-s', deviceId, 'push', tempPath, `/sdcard/Download/${filename}`]);

                this.socket.emit('adb_push_status', { deviceId, success: true, filename });
                console.log('[Agent] adb_push successful');
            } catch (error: any) {
                console.error('[Agent] adb_push failed:', error);
                this.socket.emit('adb_push_status', { deviceId, success: false, error: error.message, filename });
            } finally {
                await fs.remove(tempPath).catch(() => { });
            }
        });

        this.socket.on('adb_pull', async (data: { deviceId: string, remotePath: string }) => {
            console.log('[Agent] adb_pull received:', data);
            const { deviceId, remotePath } = data;
            const filename = path.basename(remotePath);
            const tempPath = path.join(os.tmpdir(), `adb-pull-${Date.now()}-${filename}`);

            try {
                console.log(`[Agent] Pulling ${remotePath} to ${tempPath}`);
                await execa('adb', ['-s', deviceId, 'pull', remotePath, tempPath]);

                if (!await fs.pathExists(tempPath)) {
                    throw new Error('File not found after pull');
                }

                const formData = new FormData();
                formData.append('file', fs.createReadStream(tempPath));

                const uploadUrl = `${SERVER_URL}/api/upload`;
                const response = await axios.post(uploadUrl, formData, {
                    headers: formData.getHeaders()
                });

                const responseData = response.data as any;
                this.socket.emit('adb_pull_complete', {
                    deviceId,
                    fileId: responseData.scriptId,
                    filename
                });
                console.log('[Agent] adb_pull successful, uploaded as:', responseData.scriptId);
            } catch (error: any) {
                console.error('[Agent] adb_pull failed:', error);
                this.socket.emit('adb_push_status', { deviceId, success: false, error: error.message, filename });
            } finally {
                await fs.remove(tempPath).catch(() => { });
            }
        });

        this.socket.on('adb_install', async (data: { deviceId: string, fileId: string, filename: string }) => {
            console.log('[Agent] adb_install received:', data);
            const { deviceId, fileId, filename } = data;
            const tempDir = path.join(os.tmpdir(), `adb-install-${Date.now()}`);
            await fs.ensureDir(tempDir);
            const tempPath = path.join(tempDir, filename);

            const logToTerminal = (msg: string, color: 'cyan' | 'green' | 'red' | 'yellow' = 'cyan') => {
                const colors = {
                    cyan: '\x1b[36m',
                    green: '\x1b[32m',
                    red: '\x1b[31m',
                    yellow: '\x1b[33m',
                    reset: '\x1b[0m'
                };
                const output = `\r\n${colors[color]}[Install] ${msg}${colors.reset}\r\n`;
                this.socket.emit('shell_output', { agentId: this.agentId, deviceId, output });
            };

            try {
                logToTerminal(`Starting installation of ${filename}...`, 'cyan');

                logToTerminal('Downloading file from server...', 'yellow');
                const downloadUrl = `${SERVER_URL}/api/download/${fileId}`;
                const writer = fs.createWriteStream(tempPath);
                const response = await axios.get(downloadUrl, { responseType: 'stream' });
                await pipeline(response.data as any, writer);
                logToTerminal('Download complete.', 'green');

                if (filename.endsWith('.apk')) {
                    logToTerminal(`Installing APK ${filename}... (This may take a moment)`, 'yellow');
                    console.log(`[Agent] Installing APK ${filename}...`);
                    const { stdout, stderr } = await execa('adb', ['-s', deviceId, 'install', '-r', '-t', tempPath]);

                    if (stdout) logToTerminal(stdout.replace(/\n/g, '\r\n'), 'cyan');
                    if (stderr) logToTerminal(stderr.replace(/\n/g, '\r\n'), 'red');

                } else if (filename.endsWith('.aab')) {
                    logToTerminal(`Processing AAB ${filename}...`, 'yellow');
                    console.log(`[Agent] Processing AAB ${filename}...`);

                    const possibleToolPaths = [
                        path.join(__dirname, '../../tools'),
                        path.join(process.cwd(), 'packages/agent/tools'),
                        path.join(process.cwd(), 'tools')
                    ];

                    let toolsDir = '';
                    for (const p of possibleToolPaths) {
                        if (await fs.pathExists(p)) {
                            toolsDir = p;
                            break;
                        }
                    }

                    if (!toolsDir) {
                        throw new Error(`Tools directory not found. Checked: ${possibleToolPaths.join(', ')}`);
                    }

                    console.log(`[Agent] Using tools directory: ${toolsDir}`);

                    const bundletoolJar = path.join(toolsDir, 'bundletool.jar');
                    const keystore = path.join(toolsDir, 'debug.keystore');
                    const apksPath = path.join(tempDir, 'app.apks');

                    if (!await fs.pathExists(bundletoolJar)) throw new Error(`bundletool.jar not found at ${bundletoolJar}`);
                    if (!await fs.pathExists(keystore)) throw new Error(`debug.keystore not found at ${keystore}`);

                    logToTerminal('Building APKS from bundle... (This may take a minute)', 'yellow');
                    console.log('[Agent] Building APKS...');
                    const buildResult = await execa('java', [
                        '-jar', bundletoolJar,
                        'build-apks',
                        `--bundle=${tempPath}`,
                        `--output=${apksPath}`,
                        `--ks=${keystore}`,
                        '--ks-pass=pass:android',
                        '--ks-key-alias=androiddebugkey',
                        '--key-pass=pass:android'
                    ]);
                    console.log('[Agent] Build APKS output:', buildResult.stdout);
                    if (buildResult.stdout) logToTerminal(buildResult.stdout.replace(/\n/g, '\r\n'), 'cyan');

                    logToTerminal('Installing APKS to device...', 'yellow');
                    console.log('[Agent] Installing APKS...');
                    const installResult = await execa('java', [
                        '-jar', bundletoolJar,
                        'install-apks',
                        `--apks=${apksPath}`,
                        `--device-id=${deviceId}`
                    ]);
                    console.log('[Agent] Install APKS output:', installResult.stdout);
                    if (installResult.stdout) logToTerminal(installResult.stdout.replace(/\n/g, '\r\n'), 'cyan');
                } else {
                    throw new Error('Unsupported file extension. Only .apk and .aab are supported.');
                }

                this.socket.emit('adb_install_status', { deviceId, success: true, filename });
                console.log('[Agent] adb_install successful');
                logToTerminal(`Successfully installed ${filename}!`, 'green');
            } catch (error: any) {
                console.error('[Agent] adb_install failed:', error);
                logToTerminal(`Installation failed: ${error.message}`, 'red');
                this.socket.emit('adb_install_status', { deviceId, success: false, error: error.message, filename });
            } finally {
                await fs.remove(tempDir).catch(() => { });
            }
        });

        this.socket.on('device_input', async (data: { deviceId: string, type: 'tap' | 'swipe' | 'key' | 'rotate' | 'text', x?: number, y?: number, x1?: number, y1?: number, x2?: number, y2?: number, keycode?: number, text?: string, isLandscape?: boolean }) => {
            const { deviceId, type } = data;

            try {
                if (type === 'key' && data.keycode !== undefined) {
                    console.log(`[Agent] [FastInput] KEY ${data.keycode}`);
                    execa('adb', ['-s', deviceId, 'shell', 'input', 'keyevent', data.keycode.toString()]).catch(() => { });
                    return;
                }

                if (type === 'text' && data.text) {
                    const escaped = data.text.replace(/ /g, '%s');
                    console.log(`[Agent] [FastInput] TEXT "${data.text}"`);
                    execa('adb', ['-s', deviceId, 'shell', 'input', 'text', escaped]).catch(() => { });
                    return;
                }

                if (type === 'rotate') {
                    try {
                        const { stdout } = await execa('adb', ['-s', deviceId, 'shell', 'settings', 'get', 'system', 'user_rotation']);
                        const cur = parseInt(stdout.trim()) || 0;
                        const next = cur === 1 ? 0 : 1;
                        await execa('adb', ['-s', deviceId, 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
                        await execa('adb', ['-s', deviceId, 'shell', 'settings', 'put', 'system', 'user_rotation', next.toString()]);
                        console.log(`[Agent] [FastInput] ROTATE ${cur} → ${next}`);
                    } catch (e) {
                        console.error('[Agent] Rotate failed:', e);
                    }
                    return;
                }

                const metadata = await this.getMetadata(deviceId);
                if (!metadata) {
                    console.error(`[Agent] No metadata available for ${deviceId}`);
                    return;
                }

                let { width, height, rotation } = metadata;

                execa('adb', ['-s', deviceId, 'shell', 'input', 'keyevent', '224']).catch(() => { });

                if (type === 'tap' && data.x !== undefined && data.y !== undefined) {
                    const px = Math.round(data.x * width);
                    const py = Math.round(data.y * height);
                    console.log(`[Agent] [FastInput] TAP (${px},${py}) [Rot:${rotation}]`);
                    execa('adb', ['-s', deviceId, 'shell', 'input', 'tap', px.toString(), py.toString()]).catch(() => { });
                } else if (type === 'swipe' && data.x1 !== undefined && data.y1 !== undefined && data.x2 !== undefined && data.y2 !== undefined) {
                    const px1 = Math.round(data.x1 * width);
                    const py1 = Math.round(data.y1 * height);
                    const px2 = Math.round(data.x2 * width);
                    const py2 = Math.round(data.y2 * height);
                    console.log(`[Agent] [FastInput] SWIPE (${px1},${py1})->(${px2},${py2})`);
                    execa('adb', ['-s', deviceId, 'shell', 'input', 'swipe',
                        px1.toString(), py1.toString(),
                        px2.toString(), py2.toString(),
                        '300'
                    ]).catch(() => { });
                }
            } catch (error) {
                console.error(`[Agent] Failed to execute device input:`, error);
            }
        });
    }
}
