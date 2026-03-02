import { io } from 'socket.io-client';
import { Agent, Device } from '@qa/types';
import os from 'os';
import { DeviceWatcher } from './device-watcher';
import { Streamer } from './streamer';
import { JobExecutor } from './job-executor';
import { ShellSession } from './shell-session';
import { LogcatSession } from './logcat-session';
import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import execa from 'execa';
import FormData from 'form-data';
import { pipeline } from 'stream/promises';
import { JobQueue } from './job-queue';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

const socket = io(SERVER_URL, { transports: ['websocket'] });

const agentInfo: Agent = {
    id: 'agent-' + os.hostname(),
    hostname: os.hostname(),
    ip: '127.0.0.1',
    devices: [],
    status: 'online'
};

const streamer = new Streamer(agentInfo.id, socket);
const jobExecutor = new JobExecutor();
jobExecutor.onLog = (jobId, type, message) => {
    if (socket.connected) {
        socket.emit('job_log', { jobId, type, message, timestamp: Date.now() });
    }
};
jobExecutor.onStatusChange = (jobId, status) => {
    if (socket.connected) {
        socket.emit('job_status', { jobId, status });
    }
};

const runningJobs = new Set<string>();

// Session storage: Map<deviceId, Session>
const shellSessions = new Map<string, ShellSession>();
const logcatSessions = new Map<string, LogcatSession>();
const stopTimeouts = new Map<string, NodeJS.Timeout>();

socket.on('shell_start', async (data: { agentId: string, deviceId: string }) => {
    console.log('[Agent] shell_start received:', data);
    const { deviceId } = data;

    // Clear any pending stop for this device
    const pendingStop = stopTimeouts.get(`shell:${deviceId}`);
    if (pendingStop) {
        console.log('[Agent] Cancelling pending shell_stop for', deviceId);
        clearTimeout(pendingStop);
        stopTimeouts.delete(`shell:${deviceId}`);
    }

    const existingSession = shellSessions.get(deviceId);
    if (existingSession) {
        console.log('[Agent] Shell session already exists for', deviceId, '- Resyncing state');
        socket.emit('shell_ready', { agentId: agentInfo.id, deviceId });
        setTimeout(() => existingSession.poke(), 50); // Small delay to ensure client listener is ready
        return;
    }

    const session = new ShellSession(deviceId);
    session.onOutput = (output) => {
        socket.emit('shell_output', { agentId: agentInfo.id, deviceId, output });
    };
    session.onReady = () => {
        socket.emit('shell_ready', { agentId: agentInfo.id, deviceId });
    };
    session.onExit = (code) => {
        socket.emit('shell_output', { agentId: agentInfo.id, deviceId, output: `\r\n\x1b[31m[System] Process exited with code ${code}\x1b[0m\r\n` });
        shellSessions.delete(deviceId);
    };
    session.start();
    shellSessions.set(deviceId, session);
});

socket.on('shell_input', (data: { deviceId: string, input: string }) => {
    const session = shellSessions.get(data.deviceId);
    if (session) {
        session.write(data.input);
    }
});

socket.on('shell_stop', (data: { deviceId: string }) => {
    console.log('[Agent] shell_stop received (delayed):', data);
    const { deviceId } = data;

    // Delay stop to handle React 18 strict mode mount/unmount/remount
    const timeout = setTimeout(async () => {
        const session = shellSessions.get(deviceId);
        if (session) {
            console.log('[Agent] Stopping shell session for', deviceId);
            await session.stop();
            shellSessions.delete(deviceId);
        }
        stopTimeouts.delete(`shell:${deviceId}`);
    }, 1000);

    stopTimeouts.set(`shell:${deviceId}`, timeout);
});

// --- LOGCAT ---
socket.on('logcat_start', (data: { deviceId: string }) => {
    const { deviceId } = data;
    if (logcatSessions.has(deviceId)) return;

    const session = new LogcatSession(deviceId);
    session.onLog = (log) => {
        socket.emit('logcat_data', { agentId: agentInfo.id, deviceId, log });
    };
    session.start();
    logcatSessions.set(deviceId, session);
});

socket.on('logcat_stop', async (data: { deviceId: string }) => {
    const session = logcatSessions.get(data.deviceId);
    if (session) {
        await session.stop();
        logcatSessions.delete(data.deviceId);
    }
});

socket.on('logcat_clear', async (data: { deviceId: string }) => {
    const session = logcatSessions.get(data.deviceId);
    if (session) {
        await session.clear();
    } else {
        // If no session, create temporary one just to clear? Or just clear directly.
        const temp = new LogcatSession(data.deviceId);
        await temp.clear();
    }
});

const deviceWatcher = new DeviceWatcher((devices: Device[]) => {
    console.log('Devices updated:', devices);
    agentInfo.devices = devices.map(d => ({
        ...d,
        jobStatus: runningJobs.has(d.id) ? 'running' : 'idle'
    }));
    if (socket.connected) {
        socket.emit('device_update', { agentId: agentInfo.id, devices: agentInfo.devices });
    }
});

socket.onAny((event, ...args) => {
    console.log(`[Agent] Received event: ${event}`, JSON.stringify(args));
});

const agentRunningJobs = new Set<string>();
const jobQueue = new JobQueue();

jobQueue.onQueueUpdate = (targetId, length) => {
    if (targetId === 'agent-vm') {
        agentInfo.queueLength = length;
    } else {
        agentInfo.devices = agentInfo.devices.map(d =>
            d.id === targetId ? { ...d, queueLength: length } : d
        );
    }
    socket.emit('device_update', { agentId: agentInfo.id, devices: agentInfo.devices, agentQueueLength: agentInfo.queueLength });
    // Also emit a specific queue_update if we want, but device_update is handled by server easily to update agents state.
};

socket.on('start_job', async (data: any) => {
    console.log('Received job request, adding to queue:', data);
    const { jobId, scriptId, deviceId, command, downloadUrl } = data;

    const targetId = deviceId || 'agent-vm';

    jobQueue.enqueue(targetId, async () => {
        if (deviceId) {
            // Device-targeted job
            runningJobs.add(deviceId);
            agentInfo.devices = agentInfo.devices.map(d =>
                d.id === deviceId ? { ...d, jobStatus: 'running' } : d
            );
            socket.emit('device_update', { agentId: agentInfo.id, devices: agentInfo.devices });
        } else {
            // Agent-level job
            agentRunningJobs.add(jobId);
            // Could optionally emit an agent-level status update here
        }

        try {
            await jobExecutor.startJob(jobId, downloadUrl, command, scriptId, deviceId);
        } finally {
            if (deviceId) {
                runningJobs.delete(deviceId);
                agentInfo.devices = agentInfo.devices.map(d =>
                    d.id === deviceId ? { ...d, jobStatus: 'idle' } : d
                );
                socket.emit('device_update', { agentId: agentInfo.id, devices: agentInfo.devices });
            } else {
                agentRunningJobs.delete(jobId);
            }
        }
    });
});

socket.on('stop_job', (data: { jobId: string }) => {
    jobExecutor.stopJob(data.jobId);
    // The device state will be reset in the finally block of startJob when the process is killed
});

// --- ADB PUSH/PULL ---
socket.on('adb_push', async (data: { deviceId: string, fileId: string, filename: string }) => {
    console.log('[Agent] adb_push received:', data);
    const { deviceId, fileId, filename } = data;
    const tempPath = path.join(os.tmpdir(), `adb-push-${Date.now()}-${filename}`);

    try {
        // 1. Download from server (streaming)
        const downloadUrl = `${SERVER_URL}/api/download/${fileId}`;
        const writer = fs.createWriteStream(tempPath);
        const response = await axios.get(downloadUrl, { responseType: 'stream' });
        await pipeline(response.data as any, writer);

        // 2. Push to device
        console.log(`[Agent] Pushing ${tempPath} to /sdcard/Download/${filename}`);
        await execa('adb', ['-s', deviceId, 'push', tempPath, `/sdcard/Download/${filename}`]);

        socket.emit('adb_push_status', { deviceId, success: true, filename });
        console.log('[Agent] adb_push successful');
    } catch (error: any) {
        console.error('[Agent] adb_push failed:', error);
        socket.emit('adb_push_status', { deviceId, success: false, error: error.message, filename });
    } finally {
        await fs.remove(tempPath).catch(() => { });
    }
});

socket.on('adb_pull', async (data: { deviceId: string, remotePath: string }) => {
    console.log('[Agent] adb_pull received:', data);
    const { deviceId, remotePath } = data;
    const filename = path.basename(remotePath);
    const tempPath = path.join(os.tmpdir(), `adb-pull-${Date.now()}-${filename}`);

    try {
        // 1. Pull from device
        console.log(`[Agent] Pulling ${remotePath} to ${tempPath}`);
        await execa('adb', ['-s', deviceId, 'pull', remotePath, tempPath]);

        if (!await fs.pathExists(tempPath)) {
            throw new Error('File not found after pull');
        }

        // 2. Upload to server
        const formData = new FormData();
        formData.append('file', fs.createReadStream(tempPath));

        const uploadUrl = `${SERVER_URL}/api/upload`;
        const response = await axios.post(uploadUrl, formData, {
            headers: formData.getHeaders()
        });

        const responseData = response.data as any;
        socket.emit('adb_pull_complete', {
            deviceId,
            fileId: responseData.scriptId,
            filename
        });
        console.log('[Agent] adb_pull successful, uploaded as:', responseData.scriptId);
    } catch (error: any) {
        console.error('[Agent] adb_pull failed:', error);
        // We can emit a specific error or re-use push_status
        socket.emit('adb_push_status', { deviceId, success: false, error: error.message, filename });
    } finally {
        await fs.remove(tempPath).catch(() => { });
    }
});

socket.on('adb_install', async (data: { deviceId: string, fileId: string, filename: string }) => {
    console.log('[Agent] adb_install received:', data);
    const { deviceId, fileId, filename } = data;
    const tempDir = path.join(os.tmpdir(), `adb-install-${Date.now()}`);
    await fs.ensureDir(tempDir);
    const tempPath = path.join(tempDir, filename);

    // Helper to format terminal output with colors
    const logToTerminal = (msg: string, color: 'cyan' | 'green' | 'red' | 'yellow' = 'cyan') => {
        const colors = {
            cyan: '\x1b[36m',
            green: '\x1b[32m',
            red: '\x1b[31m',
            yellow: '\x1b[33m',
            reset: '\x1b[0m'
        };
        const output = `\r\n${colors[color]}[Install] ${msg}${colors.reset}\r\n`;
        socket.emit('shell_output', { agentId: agentInfo.id, deviceId, output });
    };

    try {
        logToTerminal(`Starting installation of ${filename}...`, 'cyan');

        // 1. Download
        logToTerminal('Downloading file from server...', 'yellow');
        const downloadUrl = `${SERVER_URL}/api/download/${fileId}`;
        const writer = fs.createWriteStream(tempPath);
        const response = await axios.get(downloadUrl, { responseType: 'stream' });
        await pipeline(response.data as any, writer);
        logToTerminal('Download complete.', 'green');

        // 2. Install based on extension
        if (filename.endsWith('.apk')) {
            logToTerminal(`Installing APK ${filename}... (This may take a moment)`, 'yellow');
            console.log(`[Agent] Installing APK ${filename}...`);
            const { stdout, stderr } = await execa('adb', ['-s', deviceId, 'install', '-r', '-t', tempPath]);

            if (stdout) logToTerminal(stdout.replace(/\n/g, '\r\n'), 'cyan');
            if (stderr) logToTerminal(stderr.replace(/\n/g, '\r\n'), 'red');

        } else if (filename.endsWith('.aab')) {
            logToTerminal(`Processing AAB ${filename}...`, 'yellow');
            console.log(`[Agent] Processing AAB ${filename}...`);

            // Resolve tools path relative to project root or current module
            const possibleToolPaths = [
                path.join(__dirname, '../tools'), // From src/ or dist/
                path.join(process.cwd(), 'packages/agent/tools'), // From root
                path.join(process.cwd(), 'tools') // Fallback
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

            // Verify tools exist
            if (!await fs.pathExists(bundletoolJar)) throw new Error(`bundletool.jar not found at ${bundletoolJar}`);
            if (!await fs.pathExists(keystore)) throw new Error(`debug.keystore not found at ${keystore}`);

            // Build APKS
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

            // Install APKS
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

        socket.emit('adb_install_status', { deviceId, success: true, filename });
        console.log('[Agent] adb_install successful');
        logToTerminal(`Successfully installed ${filename}!`, 'green');
    } catch (error: any) {
        console.error('[Agent] adb_install failed:', error);
        logToTerminal(`Installation failed: ${error.message}`, 'red');
        socket.emit('adb_install_status', { deviceId, success: false, error: error.message, filename });
    } finally {
        await fs.remove(tempDir).catch(() => { });
    }
});

// Metadata Cache for low-latency input
interface DeviceMetadata {
    width: number;
    height: number;
    rotation: number;
    lastUpdated: number;
}
const metadataCache = new Map<string, DeviceMetadata>();

async function getMetadata(deviceId: string, force = false): Promise<DeviceMetadata | null> {
    const cached = metadataCache.get(deviceId);
    const now = Date.now();
    // Reduce cache TTL to 2s so rotation changes are caught immediately
    if (!force && cached && (now - cached.lastUpdated < 2000)) {
        return cached;
    }

    try {
        // Parse mOverrideDisplayInfo from dumpsys display — this has the ACTUAL current
        // screen dimensions (width x height) and rotation already applied.
        // e.g. In landscape: "real 2316 x 1080, ... rotation 1"
        // e.g. In portrait:  "real 1080 x 2316, ... rotation 0"
        const { stdout: dispStdout } = await execa('adb', ['-s', deviceId, 'shell', 'dumpsys display']);

        // Find mOverrideDisplayInfo block
        const overrideIdx = dispStdout.indexOf('mOverrideDisplayInfo');
        let width = 0, height = 0, rotation = 0;

        if (overrideIdx !== -1) {
            // 2000 chars: enough to pass the long modes[] list (~850 chars) and reach "rotation N"
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
                // Infer rotation from actual dimensions when regex doesn't reach rotation field
                rotation = width > height ? 1 : 0;
            }
        }

        // Fallback to wm size if parsing failed
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
        metadataCache.set(deviceId, metadata);
        console.log(`[Agent] Metadata refreshed for ${deviceId}: ${width}x${height} rot=${rotation}`);
        return metadata;
    } catch (e) {
        console.error(`[Agent] Failed to fetch metadata for ${deviceId}:`, e);
        return null;
    }
}


socket.on('connect', () => {
    console.log('Connected to server as', agentInfo.id);
    // Scan immediately
    deviceWatcher.start();
    socket.emit('register_agent', agentInfo);
});

socket.on('device_input', async (data: { deviceId: string, type: 'tap' | 'swipe' | 'key' | 'rotate' | 'text', x?: number, y?: number, x1?: number, y1?: number, x2?: number, y2?: number, keycode?: number, text?: string, isLandscape?: boolean }) => {
    const { deviceId, type, isLandscape } = data;

    try {
        // Key events don't need metadata
        if (type === 'key' && data.keycode !== undefined) {
            console.log(`[Agent] [FastInput] KEY ${data.keycode}`);
            execa('adb', ['-s', deviceId, 'shell', 'input', 'keyevent', data.keycode.toString()]).catch(() => { });
            return;
        }

        // Text input: send string directly to focused field
        if (type === 'text' && data.text) {
            // adb shell input text treats space as argument separator — replace with %s
            const escaped = data.text.replace(/ /g, '%s');
            console.log(`[Agent] [FastInput] TEXT "${data.text}"`);
            execa('adb', ['-s', deviceId, 'shell', 'input', 'text', escaped]).catch(() => { });
            return;
        }

        // Rotate: toggle between portrait (0) and landscape (1)
        if (type === 'rotate') {
            try {
                const { stdout } = await execa('adb', ['-s', deviceId, 'shell', 'settings', 'get', 'system', 'user_rotation']);
                const cur = parseInt(stdout.trim()) || 0;
                // Simple toggle: landscape(1) → portrait(0), anything else → landscape(1)
                const next = cur === 1 ? 0 : 1;
                await execa('adb', ['-s', deviceId, 'shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']);
                await execa('adb', ['-s', deviceId, 'shell', 'settings', 'put', 'system', 'user_rotation', next.toString()]);
                console.log(`[Agent] [FastInput] ROTATE ${cur} → ${next} (${next === 1 ? 'landscape' : 'portrait'})`);
            } catch (e) { console.error('[Agent] Rotate failed:', e); }
            return;
        }

        // Use Cache for near-instant response
        const metadata = await getMetadata(deviceId);
        if (!metadata) {
            console.error(`[Agent] No metadata available for ${deviceId}`);
            return;
        }

        let { width, height, rotation } = metadata;

        // NOTE: width & height from getMetadata are ALREADY the actual screen dimensions
        // (from mOverrideDisplayInfo "real WxH"), which correctly reflect rotation.
        // No swap needed here.

        // Auto-wake: send WAKEUP (224) before any touch — idempotent, no effect if already awake
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

socket.on('start_stream', async (data: { deviceId: string }) => {
    console.log('[Agent] start_stream received:', data);
    const { deviceId } = data;

    const pendingStop = stopTimeouts.get(`stream:${deviceId}`);
    if (pendingStop) {
        console.log('[Agent] Cancelling pending stop_stream for', deviceId);
        clearTimeout(pendingStop);
        stopTimeouts.delete(`stream:${deviceId}`);
    }

    // Force refresh metadata on stream start
    await getMetadata(deviceId, true);
    await streamer.start(deviceId);
});

socket.on('stop_stream', (data: { deviceId: string }) => {
    console.log('[Agent] stop_stream received (delayed):', data);
    const { deviceId } = data;

    const timeout = setTimeout(async () => {
        console.log('[Agent] Stopping stream for', deviceId);
        await streamer.stop(deviceId);
        stopTimeouts.delete(`stream:${deviceId}`);
    }, 1000);

    stopTimeouts.set(`stream:${deviceId}`, timeout);
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    deviceWatcher.stop();
});

// Keep process alive
process.stdin.resume();
