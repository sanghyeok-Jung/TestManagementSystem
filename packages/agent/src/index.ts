import { io } from 'socket.io-client';
import { Agent, Device } from '@qa/types';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { DeviceWatcher } from './device-watcher';
import { Streamer } from './streamer';
import { JobExecutor } from './job-executor';
import { JobQueue } from './job-queue';

import { AndroidDeviceManager } from './handlers/android-manager';
import { IosDeviceManager } from './handlers/ios-manager';
import { IDeviceManager, DeviceInputArgs } from './handlers/device-manager';
import { ShellSessionManager } from './handlers/shell-session-manager';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

const socket = io(SERVER_URL, { transports: ['websocket'] });

const getLocalIpAddress = () => {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
            if (iface.family === "IPv4" && !iface.internal) {
                return iface.address;
            }
        }
    }
    return "127.0.0.1";
};
const getAgentName = () => {
    try {
        if (process.platform === 'darwin') {
            const name = execSync('scutil --get LocalHostName', { encoding: 'utf8' }).trim();
            if (name) return name;
        }
    } catch (e) { }
    return os.hostname().split('.')[0];
};

const agentName = getAgentName();

const agentInfo: Agent = {
    id: 'agent-' + agentName,
    hostname: agentName,
    ip: getLocalIpAddress(),
    devices: [],
    status: 'online'
};

// streamer will be initialized after deviceManagers map is ready
let streamer: Streamer;
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

const shellManager = new ShellSessionManager(socket, agentInfo.id);
shellManager.setupHandlers();

// Device Managers Map
const deviceManagers = new Map<string, IDeviceManager>();
streamer = new Streamer(agentInfo.id, socket, deviceManagers);

function getManagerForDevice(deviceId: string): IDeviceManager {
    const manager = deviceManagers.get(deviceId);
    if (!manager) {
        throw new Error(`Device Manager not found for device ${deviceId}`);
    }
    return manager;
}

// Stream Management Timeouts
const stopTimeouts = new Map<string, NodeJS.Timeout>();

const deviceWatcher = new DeviceWatcher((devices: Device[]) => {
    console.log('Devices updated:', devices);
    agentInfo.devices = devices.map(d => ({
        ...d,
        jobStatus: runningJobs.has(d.id) ? 'running' : 'idle'
    }));

    // Update managers
    const currentDeviceIds = new Set(devices.map(d => d.id));
    
    // Cleanup disconnected devices
    for (const [deviceId, manager] of deviceManagers.entries()) {
        if (!currentDeviceIds.has(deviceId)) {
            manager.cleanup().catch(e => console.error(e));
            deviceManagers.delete(deviceId);
        }
    }

    // Initialize new devices
    for (const device of devices) {
        if (!deviceManagers.has(device.id)) {
            if (device.platform === 'ios') {
                deviceManagers.set(device.id, new IosDeviceManager(agentInfo.id));
            } else {
                deviceManagers.set(device.id, new AndroidDeviceManager(agentInfo.id));
            }
        }
    }

    if (socket.connected) {
        socket.emit('device_update', { agentId: agentInfo.id, devices: agentInfo.devices });
    }
});

// Setup abstracted socket handlers for devices
socket.on('adb_push', async (data: { deviceId: string, fileId: string, filename: string }) => {
    const { deviceId, fileId, filename } = data;
    try {
        const manager = getManagerForDevice(deviceId);
        await manager.pushFile(deviceId, fileId, filename);
        socket.emit('adb_push_status', { deviceId, success: true, filename });
    } catch (error: any) {
        console.error(`[Agent] Push failed for ${deviceId}:`, error.message);
        socket.emit('adb_push_status', { deviceId, success: false, error: error.message, filename });
    }
});

socket.on('adb_pull', async (data: { deviceId: string, remotePath: string }) => {
    const { deviceId, remotePath } = data;
    const filename = path.basename(remotePath);
    try {
        const manager = getManagerForDevice(deviceId);
        const result = await manager.pullFile(deviceId, remotePath);
        socket.emit('adb_pull_complete', {
            deviceId,
            fileId: result.fileId,
            filename: result.filename
        });
    } catch (error: any) {
        console.error(`[Agent] Pull failed for ${deviceId}:`, error.message);
        socket.emit('adb_push_status', { deviceId, success: false, error: error.message, filename });
    }
});

socket.on('adb_install', async (data: { deviceId: string, fileId: string, filename: string }) => {
    const { deviceId, fileId, filename } = data;
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
        const manager = getManagerForDevice(deviceId);
        await manager.installApp(deviceId, fileId, filename, logToTerminal);
        socket.emit('adb_install_status', { deviceId, success: true, filename });
    } catch (error: any) {
        console.error(`[Agent] Install failed for ${deviceId}:`, error.message);
        socket.emit('adb_install_status', { deviceId, success: false, error: error.message, filename });
    }
});

socket.on('device_input', async (data: any) => {
    const { deviceId, type, ...args } = data;
    try {
        const manager = getManagerForDevice(deviceId);
        await manager.sendInput(deviceId, { type, ...args } as DeviceInputArgs);
    } catch (error: any) {
        console.error(`[Agent] Input failed for ${deviceId}:`, error.message);
    }
});


socket.onAny((event, ...args) => {
    // Avoid spamming logs for frequent stream data
    if (event !== 'stream_data') {
        console.log(`[Agent] Received event: ${event}`);
    }
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
            socket.emit('device_update', { agentId: agentInfo.id, devices: agentInfo.devices, agentQueueLength: agentInfo.queueLength });
        } else {
            // Agent-level job
            agentRunningJobs.add(jobId);
        }

        try {
            await jobExecutor.startJob(jobId, downloadUrl, command, scriptId, deviceId);
        } finally {
            if (deviceId) {
                runningJobs.delete(deviceId);
                agentInfo.devices = agentInfo.devices.map(d =>
                    d.id === deviceId ? { ...d, jobStatus: 'idle' } : d
                );
                socket.emit('device_update', { agentId: agentInfo.id, devices: agentInfo.devices, agentQueueLength: agentInfo.queueLength });
            } else {
                agentRunningJobs.delete(jobId);
            }
        }
    });
});

socket.on('stop_job', (data: { jobId: string }) => {
    jobExecutor.stopJob(data.jobId);
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

    try {
        const manager = getManagerForDevice(deviceId);
        await manager.getMetadata(deviceId, true);
    } catch(e) {}
    
    const device = agentInfo.devices.find(d => d.id === deviceId);
    if (!device) {
        console.error(`[Agent] start_stream: Device ${deviceId} not found in agent list`);
        return;
    }
    await streamer.start(deviceId, device.platform as 'android' | 'ios');
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

socket.on('connect', () => {
    console.log('Connected to server as', agentInfo.id);
    // Scan immediately
    deviceWatcher.start();
    socket.emit('register_agent', agentInfo);
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    deviceWatcher.stop();
});

// Cleanup processes on application exit
process.on('SIGINT', async () => {
    console.log('\n[Agent] Cleaning up before exit...');
    deviceWatcher.stop();
    for (const manager of deviceManagers.values()) {
        await manager.cleanup().catch(() => {});
    }
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log('\n[Agent] Cleaning up before exit...');
    deviceWatcher.stop();
    for (const manager of deviceManagers.values()) {
        await manager.cleanup().catch(() => {});
    }
    process.exit(0);
});

// Keep process alive
process.stdin.resume();
