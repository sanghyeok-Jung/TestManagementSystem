import { Server, Socket } from 'socket.io';
import { Agent, Device } from '@qa/types';
import { JobManager } from '../jobs';

export function setupSocketHandlers(io: Server, agents: Map<string, Agent>, deviceOwners: Map<string, string>, jobManager: JobManager) {
    io.on('connection', (socket: Socket) => {
        console.log('Client connected:', socket.id);

        // Send current state to new client (Frontend)
        socket.emit('agents_updated', Array.from(agents.values()));
        socket.emit('occupancy_updated', Object.fromEntries(deviceOwners));

        socket.on('register_agent', (agentInfo: Agent) => {
            console.log('Agent registered:', agentInfo.id);

            // Get real IP from socket handshake
            let realIp = socket.handshake.address;
            const xForwardedFor = socket.handshake.headers["x-forwarded-for"];
            if (xForwardedFor) {
                realIp = Array.isArray(xForwardedFor) ? xForwardedFor[0] : (xForwardedFor as string).split(",")[0];
            }
            if (realIp === "::1") realIp = "127.0.0.1";
            if (realIp && realIp.startsWith("::ffff:")) realIp = realIp.substring(7);
            agentInfo.ip = realIp || agentInfo.ip;

            // Mark as online
            agentInfo.status = 'online';
            agents.set(agentInfo.id, agentInfo);
            // Broadcast update
            io.emit('agents_updated', Array.from(agents.values()));

            // Associate socket with agent ID for disconnect handling
            socket.data.agentId = agentInfo.id;
        });

        socket.on('device_update', (data: { agentId: string, devices: Device[], agentQueueLength?: number }) => {
            const { agentId, devices, agentQueueLength } = data;
            const agent = agents.get(agentId);
            if (agent) {
                agent.devices = devices;
                if (agentQueueLength !== undefined) {
                    agent.queueLength = agentQueueLength;
                }
                agents.set(agentId, agent);
                io.emit('agents_updated', Array.from(agents.values()));
            }
        });

        socket.on('disconnect', () => {
            const agentId = socket.data.agentId;
            if (agentId) {
                console.log('Agent disconnected:', agentId);
                const agent = agents.get(agentId);
                if (agent) {
                    agent.status = 'offline';
                    agents.set(agentId, agent);
                    io.emit('agents_updated', Array.from(agents.values()));
                }
            }

            // Cleanup ownerships
            for (const [deviceId, ownerId] of deviceOwners.entries()) {
                if (ownerId === socket.id) {
                    deviceOwners.delete(deviceId);
                    console.log(`[Server] Ownership cleared for ${deviceId} due to disconnect`);
                }
            }
            io.emit('occupancy_updated', Object.fromEntries(deviceOwners));

            console.log('Client disconnected:', socket.id);
        });

        socket.on('get_occupancy', () => {
            socket.emit('occupancy_updated', Object.fromEntries(deviceOwners));
        });

        // Relay Stream Commands (Frontend -> Server -> Agent)
        socket.on('join_stream', (data: { agentId: string, deviceId: string }) => {
            const room = `stream:${data.agentId}:${data.deviceId}`;
            socket.join(room);
            console.log(`Socket ${socket.id} joined ${room}`);

            // Try to take ownership if free
            if (!deviceOwners.has(data.deviceId)) {
                deviceOwners.set(data.deviceId, socket.id);
                io.emit('occupancy_updated', Object.fromEntries(deviceOwners));
            }

            // Notify agent to start if it's the first watcher (simplified)
            const agentSocket = Array.from(io.sockets.sockets.values()).find(s => s.data.agentId === data.agentId);
            if (agentSocket) {
                agentSocket.emit('start_stream', { deviceId: data.deviceId });
            }
        });

        socket.on('leave_stream', (data: { agentId: string, deviceId: string }) => {
            const room = `stream:${data.agentId}:${data.deviceId}`;
            socket.leave(room);
            console.log(`Socket ${socket.id} left ${room}`);

            // If owner leaves, clear it
            if (deviceOwners.get(data.deviceId) === socket.id) {
                deviceOwners.delete(data.deviceId);
                io.emit('occupancy_updated', Object.fromEntries(deviceOwners));
            }

            // Notify agent to stop if no more watchers (simplified)
            const roomObj = io.sockets.adapter.rooms.get(room);
            if (!roomObj || roomObj.size === 0) {
                const agentSocket = Array.from(io.sockets.sockets.values()).find(s => s.data.agentId === data.agentId);
                if (agentSocket) {
                    agentSocket.emit('stop_stream', { deviceId: data.deviceId });
                }
            }
        });

        socket.on('stream_data', (data: { deviceId: string, chunk: Buffer }) => {
            const agentId = socket.data.agentId;
            if (agentId) {
                const room = `stream:${agentId}:${data.deviceId}`;
                const roomMembers = io.sockets.adapter.rooms.get(room);
                if (roomMembers && roomMembers.size > 0) {
                    socket.to(room).emit('stream_data', data);
                }
            }
        });

        socket.on('stream_preview', (data: { deviceId: string, image: string }) => {
            const agentId = socket.data.agentId;
            if (agentId) {
                const room = `stream:${agentId}:${data.deviceId}`;
                socket.to(room).emit('stream_preview', data);
                console.log(`[Stream] Preview relayed for ${data.deviceId}`);
            }
        });

        socket.on('stream_reset', (data: { deviceId: string }) => {
            const agentId = socket.data.agentId;
            if (agentId) {
                const room = `stream:${agentId}:${data.deviceId}`;
                socket.to(room).emit('stream_reset', data);
                console.log(`[Stream] Reset relayed for ${data.deviceId}`);
            }
        });

        socket.on('start_stream', (data: { agentId: string, deviceId: string }) => {
            console.log('Request start_stream:', data);
            const agentSocket = Array.from(io.sockets.sockets.values()).find(s => s.data.agentId === data.agentId);
            if (agentSocket) {
                agentSocket.emit('start_stream', { deviceId: data.deviceId });
            }
        });

        socket.on('stop_stream', (data: { agentId: string, deviceId: string }) => {
            console.log('Request stop_stream:', data);
            const agentSocket = Array.from(io.sockets.sockets.values()).find(s => s.data.agentId === data.agentId);
            if (agentSocket) {
                agentSocket.emit('stop_stream', { deviceId: data.deviceId });
            }
        });

        socket.on('job_log', async (data: any) => {
            await jobManager.appendLog(data);
            io.emit('job_log', data);
        });

        socket.on('job_status', (data: { jobId: string, status: 'completed' | 'failed' }) => {
            jobManager.updateJobStatus(data.jobId, data.status);
            const job = jobManager.getJob(data.jobId);
            if (job) io.emit('job_updated', job);
        });

        // --- DEVICE CONTROL RELAY ---
        const forwardToAgent = (event: string, data: any) => {
            const agentSocket = Array.from(io.sockets.sockets.values()).find(s => s.data?.agentId === data.agentId);
            if (agentSocket) {
                console.log(`[Server] Relay ${event} to agent ${data.agentId} (Socket: ${agentSocket.id})`);
                agentSocket.emit(event, data);
            } else {
                console.log(`[Server] FAILED to relay ${event}: Agent ${data.agentId} not found.`);
            }
        };

        const forwardToFrontend = (event: string, data: any) => {
            io.emit(event, data);
        };

        // Frontend -> Agent
        socket.on('shell_start', (data) => {
            console.log('[Server] shell_start received:', data);
            forwardToAgent('shell_start', data);
        });
        socket.on('shell_input', (data) => forwardToAgent('shell_input', data));
        socket.on('shell_stop', (data) => forwardToAgent('shell_stop', data));
        socket.on('logcat_start', (data) => forwardToAgent('logcat_start', data));
        socket.on('logcat_stop', (data) => forwardToAgent('logcat_stop', data));
        socket.on('logcat_clear', (data) => forwardToAgent('logcat_clear', data));
        socket.on('device_input', (data) => forwardToAgent('device_input', data));
        socket.on('adb_push', (data) => forwardToAgent('adb_push', data));
        socket.on('adb_pull', (data) => forwardToAgent('adb_pull', data));
        socket.on('adb_install', (data) => forwardToAgent('adb_install', data));

        // Agent -> Frontend
        socket.on('shell_ready', (data) => forwardToFrontend('shell_ready', data));
        socket.on('shell_output', (data) => forwardToFrontend('shell_output', data));
        socket.on('logcat_data', (data) => forwardToFrontend('logcat_data', data));
        socket.on('adb_push_status', (data) => forwardToFrontend('adb_push_status', data));
        socket.on('adb_pull_complete', (data) => forwardToFrontend('adb_pull_complete', data));
        socket.on('adb_install_status', (data) => forwardToFrontend('adb_install_status', data));
    });
}
