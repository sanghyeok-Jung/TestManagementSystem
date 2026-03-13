import { DeviceMetadata, DeviceInputArgs, IDeviceManager } from './device-manager';
import getPort from 'get-port';
import execa from 'execa';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

export class IosDeviceManager implements IDeviceManager {
    private agentId: string;
    private metadataCache = new Map<string, DeviceMetadata>();
    private wdaPorts = new Map<string, number>();
    private proxyProcesses = new Map<string, execa.ExecaChildProcess>();
    private tunnelProcesses = new Map<string, execa.ExecaChildProcess>();
    private wdaSessionIds = new Map<string, string>();
    private mjpegPorts = new Map<string, number>();
    private mjpegProxyProcesses = new Map<string, execa.ExecaChildProcess>();

    constructor(agentId: string) {
        this.agentId = agentId;
    }

    private async getIosBinary(): Promise<string> {
        // 1. Check if 'ios' is in PATH
        try {
            await execa('ios', ['--version']);
            return 'ios';
        } catch (e) {
            // 2. Check if 'go-ios' is in PATH
            try {
                await execa('go-ios', ['--version']);
                return 'go-ios';
            } catch (e2) {
                // 3. Check for local npm install in node_modules
                const arch = process.arch === 'x64' ? 'amd64' : process.arch;
                const platform = process.platform === 'darwin' ? 'darwin' : process.platform;
                
                const localPaths = [
                    path.resolve(process.cwd(), `node_modules/go-ios/dist/go-ios-${platform}-${arch}_${platform}_${arch}/ios`),
                    path.resolve(process.cwd(), `../node_modules/go-ios/dist/go-ios-${platform}-${arch}_${platform}_${arch}/ios`),
                    path.resolve(process.cwd(), `../../node_modules/go-ios/dist/go-ios-${platform}-${arch}_${platform}_${arch}/ios`),
                    path.resolve(__dirname, `../../node_modules/go-ios/dist/go-ios-${platform}-${arch}_${platform}_${arch}/ios`),
                    path.resolve(__dirname, `../../../node_modules/go-ios/dist/go-ios-${platform}-${arch}_${platform}_${arch}/ios`),
                    path.resolve(process.cwd(), `node_modules/go-ios/dist/go-ios-darwin-amd64_darwin_amd64/ios`),
                ];

                for (const p of localPaths) {
                    if (fs.existsSync(p)) {
                        return p;
                    }
                }
            }
        }
        return 'ios'; // Fallback
    }

    private async ensureWdaSession(deviceId: string): Promise<number> {
        if (this.wdaPorts.has(deviceId)) {
            return this.wdaPorts.get(deviceId)!;
        }

        console.log(`[IosManager] Setting up WDA port forwarding for ${deviceId}`);
        const freePort = await getPort();
        
        // Start iproxy to forward freePort -> 8100 on the device
        const proxyProcess = execa('iproxy', ['-u', deviceId, `${freePort}:8100`]);
        
        proxyProcess.catch((err) => {
            console.error(`[IosManager] iproxy process for ${deviceId} exited:`, err.message);
            this.wdaPorts.delete(deviceId);
            this.proxyProcesses.delete(deviceId);
        });

        this.wdaPorts.set(deviceId, freePort);
        this.proxyProcesses.set(deviceId, proxyProcess);

        // For iOS 17+, we might need a tunnel
        let osVer = this.metadataCache.get(deviceId)?.osVersion;
        if (!osVer) {
            try {
                const { stdout } = await execa('ideviceinfo', ['-u', deviceId, '-k', 'ProductVersion'], { timeout: 2000 });
                osVer = stdout.trim();
            } catch (e) {
                osVer = '0';
            }
        }
        const majorVersion = parseInt(osVer.split('.')[0]);
        
        if (majorVersion >= 17 || majorVersion > 20) { // Handling 26.3.1 build string as well
            console.log(`[IosManager] Starting go-ios tunnel for ${deviceId} (iOS ${osVer})`);
            const iosBin = await this.getIosBinary();
            const tunnelProcess = execa(iosBin, ['tunnel', 'start', '--udid=' + deviceId, '--userspace'], {
                env: { ...process.env, ENABLE_GO_IOS_AGENT: 'user' }
            });
            tunnelProcess.catch(e => console.warn(`[IosManager] Tunnel for ${deviceId} failed/exited:`, e.message));
            this.tunnelProcesses.set(deviceId, tunnelProcess);
            // Wait a bit more for tunnel
            await new Promise(r => setTimeout(r, 2000));
        }

        // Wait a bit for proxy to establish and try to connect (with retries)
        let ready = false;
        for (let i = 0; i < 5; i++) {
            await new Promise(r => setTimeout(r, 1000));
            try {
                const statusUrl = `http://127.0.0.1:${freePort}/status`;
                const res = await axios.get(statusUrl, { timeout: 2000 });
                const statusData = res.data as any;
                
                if (statusData?.value?.ready || statusData?.value?.state === 'success' || (statusData?.status === 0 && statusData?.value)) {
                    console.log(`[IosManager] WDA is ready on port ${freePort} for ${deviceId}`);
                    
                    // 1. Try to get sessionId from status directly
                    let sessionId = statusData?.sessionId || statusData?.value?.sessionId;
                    
                    // 2. If not in status, try /sessions
                    if (!sessionId) {
                        try {
                            const sessRes = await axios.get(`http://127.0.0.1:${freePort}/sessions`, { timeout: 2000 });
                            const sessions = (sessRes.data as any)?.value || [];
                            if (sessions.length > 0) {
                                sessionId = sessions[0].id;
                            }
                        } catch (e) {}
                    }
                    
                    // 3. If still not found, try to create one
                    if (!sessionId) {
                        try {
                            const createRes = await axios.post(`http://127.0.0.1:${freePort}/session`, {
                                capabilities: { alwaysMatch: { bundleId: 'com.apple.mobilesafari' } }
                            }, { timeout: 5000 });
                            sessionId = (createRes.data as any)?.sessionId || (createRes.data as any)?.value?.sessionId;
                        } catch (e: any) {
                            console.error(`[IosManager] Failed to create WDA session: ${e.message}`, e.response?.data);
                        }
                    }

                    if (sessionId) {
                        this.wdaSessionIds.set(deviceId, sessionId);
                        console.log(`[IosManager] Successfully bound to WDA session: ${sessionId}`);
                    } else {
                        console.warn(`[IosManager] Could not determine WDA session ID for ${deviceId}. Some commands may fail.`);
                    }

                    ready = true;
                    break;
                }
            } catch (e: any) {
                console.log(`[IosManager] WDA not ready yet on port ${freePort} (attempt ${i+1}): ${e.message}`);
            }
        }

        if (!ready) {
            console.error(`[IosManager] Failed to connect to WDA on port ${freePort} for ${deviceId} after 5s.`);
        }

        return freePort;
    }

    async getMetadata(deviceId: string, force = false): Promise<DeviceMetadata | null> {
        const cached = this.metadataCache.get(deviceId);
        const now = Date.now();
        if (!force && cached && (now - cached.lastUpdated < 2000)) {
            return cached;
        }

        try {
            const port = await this.ensureWdaSession(deviceId);
            const sessionId = this.wdaSessionIds.get(deviceId) || 'dummy';
            
            let width = 375;
            let height = 812;
            let rotation = 0;

            try {
                // Try /window/size (legacy) or /window/rect (modern)
                const res = await axios.get(`http://127.0.0.1:${port}/session/${sessionId}/window/size`, { timeout: 3000 });
                const data = res.data as any;
                if (data?.value) {
                    width = data.value.width;
                    height = data.value.height;
                }
            } catch (wdaSizeErr: any) {
                console.log(`[IosManager] /window/size failed (state=${wdaSizeErr.response?.status}), trying /window/rect...`);
                try {
                    const rectRes = await axios.get(`http://127.0.0.1:${port}/session/${sessionId}/window/rect`, { timeout: 3000 });
                    const rectData = rectRes.data as any;
                    if (rectData?.value) {
                        width = rectData.value.width;
                        height = rectData.value.height;
                    }
                } catch (wdaRectErr: any) {
                    console.error(`[IosManager] Both /window/size and /window/rect failed for ${deviceId}. Falling back to default dims.`, 
                        wdaRectErr.response?.data || wdaRectErr.message);
                }
            }

            let osVer = cached?.osVersion;
            if (!osVer) {
                try {
                    const { stdout } = await execa('ideviceinfo', ['-u', deviceId, '-k', 'ProductVersion'], { timeout: 2000 });
                    osVer = stdout.trim();
                } catch (e) {
                    osVer = 'Unknown';
                }
            }

            const metadata = { width, height, rotation, lastUpdated: now, osVersion: osVer };
            this.metadataCache.set(deviceId, metadata);
            return metadata;
        } catch (error: any) {
            console.error(`[IosManager] Failed to fetch metadata for ${deviceId}:`, error.message);
        }
        
        // Fallback or if WDA fails
        return { width: 375, height: 812, rotation: 0, lastUpdated: now };
    }

    async pushFile(deviceId: string, fileId: string, filename: string): Promise<void> {
        console.log(`[IosManager] pushFile not fully supported via WDA/go-ios yet.`);
        // Note: For real iOS devices without jailbreak, pushing arbitrary files is restricted.
        // Usually done via an app container. We return success for now to avoid breaking UI.
        return Promise.resolve();
    }

    async pullFile(deviceId: string, remotePath: string): Promise<{ fileId: string, filename: string }> {
         console.log(`[IosManager] pullFile not fully supported via WDA/go-ios yet.`);
         throw new Error("Pulling files from iOS is restricted to app containers.");
    }

    async installApp(deviceId: string, fileId: string, filename: string, logToTerminal: (msg: string, color?: "cyan" | "green" | "red" | "yellow") => void): Promise<void> {
        console.log(`[IosManager] installApp received: ${deviceId} ${filename}`);
        const tempDir = path.join(os.tmpdir(), `ios-install-${Date.now()}`);
        await fs.ensureDir(tempDir);
        const tempPath = path.join(tempDir, filename);

        try {
            logToTerminal(`Starting installation of ${filename}...`, 'cyan');

            if (!filename.endsWith('.ipa')) {
                throw new Error('Only .ipa files are supported for iOS installation.');
            }

            logToTerminal('Downloading file from server...', 'yellow');
            const downloadUrl = `${SERVER_URL}/api/download/${fileId}`;
            const writer = fs.createWriteStream(tempPath);
            const response = await axios.get(downloadUrl, { responseType: 'stream' });
            await pipeline(response.data as any, writer);
            logToTerminal('Download complete.', 'green');

            logToTerminal(`Installing IPA ${filename}... (This may take a moment)`, 'yellow');
            
            // Use go-ios as primary (since it's now bundled), fallback to ideviceinstaller
            const iosBin = await this.getIosBinary();
            try {
                const { stdout, stderr } = await execa(iosBin, ['install', '--path=' + tempPath, '--udid=' + deviceId], {
                    env: { ...process.env, ENABLE_GO_IOS_AGENT: 'user' }
                });
                if (stdout) logToTerminal(stdout.replace(/\n/g, '\r\n'), 'cyan');
                if (stderr) logToTerminal(stderr.replace(/\n/g, '\r\n'), 'red');
            } catch (e: any) {
                logToTerminal(`Primary installation (go-ios) failed: ${e.message}. Trying ideviceinstaller...`, 'yellow');
                const { stdout, stderr } = await execa('ideviceinstaller', ['-u', deviceId, '-i', tempPath]);
                if (stdout) logToTerminal(stdout.replace(/\n/g, '\r\n'), 'cyan');
                if (stderr) logToTerminal(stderr.replace(/\n/g, '\r\n'), 'red');
            }
 
            console.log('[IosManager] installApp successful');
            logToTerminal(`Successfully installed ${filename}!`, 'green');
        } catch (error: any) {
             console.error('[IosManager] installApp failed:', error);
             logToTerminal(`Installation failed: ${error.message}`, 'red');
             throw error;
        } finally {
            await fs.remove(tempDir).catch(() => { });
        }
    }

    async sendInput(deviceId: string, data: DeviceInputArgs): Promise<void> {
        const { type } = data;
        try {
            const port = await this.ensureWdaSession(deviceId);
            const sessionId = this.wdaSessionIds.get(deviceId) || 'dummy';
            const baseUrl = `http://127.0.0.1:${port}/session/${sessionId}`;

            const metadata = await this.getMetadata(deviceId);
            if (!metadata) return;

            if (type === 'tap' && data.x !== undefined && data.y !== undefined) {
                // WDA expects point coordinates (not pixels)
                const px = Math.round(data.x * metadata.width);
                const py = Math.round(data.y * metadata.height);
                
                // W3C WebDriver Actions API
                await axios.post(`${baseUrl}/actions`, {
                    actions: [{
                        type: 'pointer',
                        id: 'finger1',
                        parameters: { pointerType: 'touch' },
                        actions: [
                            { type: 'pointerMove', duration: 0, x: px, y: py },
                            { type: 'pointerDown', button: 0 },
                            { type: 'pause', duration: 50 },
                            { type: 'pointerUp', button: 0 },
                        ]
                    }]
                });
                console.log(`[IosManager] [FastInput] TAP (${px},${py})`);

            } else if (type === 'swipe' && data.x1 !== undefined && data.y1 !== undefined && data.x2 !== undefined && data.y2 !== undefined) {
                 const fromX = Math.round(data.x1 * metadata.width);
                 const fromY = Math.round(data.y1 * metadata.height);
                 const toX = Math.round(data.x2 * metadata.width);
                 const toY = Math.round(data.y2 * metadata.height);
                 
                 // W3C WebDriver Actions API for swipe
                 await axios.post(`${baseUrl}/actions`, {
                    actions: [{
                        type: 'pointer',
                        id: 'finger1',
                        parameters: { pointerType: 'touch' },
                        actions: [
                            { type: 'pointerMove', duration: 0, x: fromX, y: fromY },
                            { type: 'pointerDown', button: 0 },
                            { type: 'pointerMove', duration: 300, x: toX, y: toY },
                            { type: 'pointerUp', button: 0 },
                        ]
                    }]
                 });
                 console.log(`[IosManager] [FastInput] SWIPE (${fromX},${fromY})->(${toX},${toY})`);

            } else if (type === 'key' && data.keycode !== undefined) {
                const wdaBase = `http://127.0.0.1:${port}`;
                switch (data.keycode) {
                    case 3: // HOME
                        await axios.post(`${wdaBase}/wda/homescreen`);
                        console.log(`[IosManager] [Key] HOME`);
                        break;
                    case 26: // POWER — toggle lock/unlock
                    case 0:  // iOS power alias from frontend
                        // Check if locked, then toggle
                        try {
                            const resp = await axios.get(`${wdaBase}/wda/locked`);
                            if ((resp.data as any)?.value) {
                                await axios.post(`${wdaBase}/wda/unlock`);
                                console.log(`[IosManager] [Key] UNLOCK`);
                            } else {
                                await axios.post(`${wdaBase}/wda/lock`);
                                console.log(`[IosManager] [Key] LOCK`);
                            }
                        } catch {
                            // Fallback: just lock
                            await axios.post(`${wdaBase}/wda/lock`);
                            console.log(`[IosManager] [Key] LOCK (fallback)`);
                        }
                        break;
                    case 24: // VOLUME UP
                        await axios.post(`${baseUrl}/wda/pressButton`, { name: 'volumeUp' });
                        console.log(`[IosManager] [Key] VOLUME_UP`);
                        break;
                    case 25: // VOLUME DOWN
                        await axios.post(`${baseUrl}/wda/pressButton`, { name: 'volumeDown' });
                        console.log(`[IosManager] [Key] VOLUME_DOWN`);
                        break;
                    case 224: // WAKEUP
                        await axios.post(`${wdaBase}/wda/unlock`);
                        console.log(`[IosManager] [Key] WAKEUP`);
                        break;
                    default:
                        console.log(`[IosManager] [Key] Unmapped keycode: ${data.keycode}`);
                }
            } else if (type === 'text' && data.text) {
                await axios.post(`${baseUrl}/wda/keys`, {
                    value: data.text.split('')
                });
            }
        } catch (error: any) {
            console.error(`[IosManager] Failed to execute device input:`, error.message);
        }
    }

    /**
     * Returns the local port for the WDA MJPEG streaming server.
     * Starts iproxy forwarding device port 9100 → local random port.
     */
    async getMjpegPort(deviceId: string): Promise<number | null> {
        if (this.mjpegPorts.has(deviceId)) {
            return this.mjpegPorts.get(deviceId)!;
        }

        // Ensure WDA session is up first (this also starts tunnel + iproxy for port 8100)
        await this.ensureWdaSession(deviceId);

        const mjpegLocalPort = await getPort();
        console.log(`[IosManager] Starting MJPEG iproxy for ${deviceId}: local ${mjpegLocalPort} → device 9100`);

        const mjpegProxy = execa('iproxy', ['-u', deviceId, `${mjpegLocalPort}:9100`]);
        mjpegProxy.catch((err) => {
            console.warn(`[IosManager] MJPEG iproxy for ${deviceId} exited:`, err.message);
            this.mjpegPorts.delete(deviceId);
            this.mjpegProxyProcesses.delete(deviceId);
        });

        this.mjpegPorts.set(deviceId, mjpegLocalPort);
        this.mjpegProxyProcesses.set(deviceId, mjpegProxy);

        // Give iproxy a moment to bind
        await new Promise(r => setTimeout(r, 500));
        return mjpegLocalPort;
    }

    async cleanup(): Promise<void> {
        for (const [deviceId, process] of this.proxyProcesses.entries()) {
            console.log(`[IosManager] Cleaning up iproxy for ${deviceId}`);
            process.kill();
        }
        for (const [deviceId, process] of this.mjpegProxyProcesses.entries()) {
            console.log(`[IosManager] Cleaning up MJPEG iproxy for ${deviceId}`);
            process.kill();
        }
        for (const [deviceId, process] of this.tunnelProcesses.entries()) {
            console.log(`[IosManager] Cleaning up tunnel for ${deviceId}`);
            process.kill();
        }
        this.proxyProcesses.clear();
        this.mjpegProxyProcesses.clear();
        this.tunnelProcesses.clear();
        this.wdaPorts.clear();
        this.mjpegPorts.clear();
        this.wdaSessionIds.clear();
    }
}
