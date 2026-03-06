import { io } from 'socket.io-client';
import { Agent, Device } from '@qa/types';
import os from 'os';
import { execSync } from 'child_process';
import { DeviceWatcher } from './device-watcher';
import { Streamer } from './streamer';
import { JobExecutor } from './job-executor';
import { JobQueue } from './job-queue';

import { AdbManager } from './handlers/adb-manager';
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

// Initialize Handlers
const adbManager = new AdbManager(socket, agentInfo.id);
adbManager.setupHandlers();

const shellManager = new ShellSessionManager(socket, agentInfo.id);
shellManager.setupHandlers();

// Stream Management Timeouts
const stopTimeouts = new Map<string, NodeJS.Timeout>();

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
            socket.emit('device_update', { agentId: agentInfo.id, devices: agentInfo.devices });
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
                socket.emit('device_update', { agentId: agentInfo.id, devices: agentInfo.devices });
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

    // Force refresh metadata on stream start via AdbManager
    await adbManager.getMetadata(deviceId, true);
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

// Keep process alive
process.stdin.resume();
