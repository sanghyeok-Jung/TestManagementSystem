import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fs from 'fs-extra';
import path from 'path';
import { Server } from 'socket.io';
import AdmZip from 'adm-zip';
import { Agent, Device } from '@qa/types';

import { pipeline } from 'stream/promises';
import { ProjectManager } from './projects';
import { JobManager } from './jobs';

const fastify = Fastify({ logger: true });

// Register Plugins
fastify.register(multipart, {
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB
    }
});

const UPLOAD_DIR = path.join(__dirname, '../uploads');
fs.ensureDirSync(UPLOAD_DIR);

const projectManager = new ProjectManager();
const jobManager = new JobManager();

// HTTP Endpoints
fastify.get('/api/projects', async (req, reply) => {
    return projectManager.getAll();
});

fastify.post('/api/projects', async (req, reply) => {
    const data = await req.file();
    if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
    }

    try {
        const project = await projectManager.create(data);
        return project;
    } catch (error) {
        req.log.error(error);
        return reply.status(500).send({ error: 'Failed to create project' });
    }
});

fastify.delete('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const success = await projectManager.delete(id);
    if (!success) {
        return reply.status(404).send({ error: 'Project not found' });
    }
    return { success: true };
});

// --- File Endpoints ---

fastify.get('/api/projects/:id/files', async (req, reply) => {
    const { id } = req.params as { id: string };
    const files = await projectManager.listFiles(id);
    return { files };
});

fastify.get('/api/projects/:id/files/content', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { file } = req.query as { file: string };

    if (!file) return reply.status(400).send({ error: 'File path required' });

    const content = await projectManager.readFile(id, file);
    if (content === null) {
        return reply.status(404).send({ error: 'File not found or cannot be read' });
    }
    return { content };
});

fastify.put('/api/projects/:id/files/content', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { file, content } = req.body as { file: string, content: string };

    if (!file || typeof content !== 'string') {
        return reply.status(400).send({ error: 'File path and content required' });
    }

    const success = await projectManager.writeFile(id, file, content);
    if (!success) {
        return reply.status(500).send({ error: 'Failed to write file' });
    }
    return { success: true };
});

fastify.delete('/api/projects/:id/files/content', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { file } = req.query as { file: string };

    if (!file) return reply.status(400).send({ error: 'File path required' });

    const success = await projectManager.deleteFile(id, file);
    if (!success) {
        return reply.status(500).send({ error: 'Failed to delete file' });
    }
    return { success: true };
});

// Legacy Upload Endpoint (Keep for ADB)
fastify.post('/api/upload', async (req, reply) => {
    const data = await req.file();
    if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
    }

    const filename = `${Date.now()}-${data.filename}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    await pipeline(data.file, fs.createWriteStream(filepath));

    return {
        success: true,
        scriptId: filename,
        url: `/uploads/${filename}`
    };
});

fastify.post('/api/jobs', async (req, reply) => {
    const { scriptId, agentId, deviceId, command } = req.body as {
        scriptId: string,
        agentId: string,
        deviceId?: string, // Now optional
        command: string
    };

    console.log('Starting job:', { scriptId, agentId, deviceId, command });

    // Find Agent Socket
    // In real app, manage this better
    const agentSocket = Array.from(io.sockets.sockets.values()).find(s => s.data.agentId === agentId);

    if (!agentSocket) {
        return reply.status(404).send({ error: 'Agent not found' });
    }

    const job = jobManager.createJob(scriptId, agentId, command, deviceId);

    // Send Job to Agent
    agentSocket.emit('start_job', {
        jobId: job.id,
        scriptId,
        deviceId,
        command,
        downloadUrl: `http://localhost:3000/api/download/${scriptId}`
    });

    return { success: true, job };
});

fastify.get('/api/devices/:deviceId/jobs', async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    return jobManager.getJobsForDevice(deviceId);
});

fastify.get('/api/jobs', async (req, reply) => {
    return jobManager.getAll();
});

fastify.get('/api/jobs/:jobId/logs', async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const logs = await jobManager.getJobLogs(jobId);
    return { logs };
});

fastify.get('/api/download/:scriptId', async (req, reply) => {
    const { scriptId } = req.params as { scriptId: string };

    // Check if it's a project
    if (scriptId.startsWith('proj-')) {
        const projectDir = path.join(UPLOAD_DIR, 'projects', scriptId);
        if (!fs.existsSync(projectDir)) {
            return reply.status(404).send({ error: 'Project not found' });
        }

        try {
            const zip = new AdmZip();
            // Add everything in the project directory, EXCEPT source.zip
            const items = await fs.readdir(projectDir, { withFileTypes: true });
            for (const item of items) {
                if (item.name === 'source.zip') continue;

                const itemPath = path.join(projectDir, item.name);
                if (item.isDirectory()) {
                    zip.addLocalFolder(itemPath, item.name);
                } else {
                    zip.addLocalFile(itemPath);
                }
            }

            const buffer = zip.toBuffer();
            reply.header('Content-Type', 'application/zip');
            return reply.send(buffer);
        } catch (error) {
            req.log.error(error);
            return reply.status(500).send({ error: 'Failed to create project zip' });
        }
    }

    // Legacy fallback
    const filepath = path.join(UPLOAD_DIR, scriptId);
    if (!fs.existsSync(filepath)) {
        return reply.status(404).send({ error: 'File not found' });
    }
    return reply.send(fs.createReadStream(filepath));
});

// Stream Relay Logic (Now handled via Socket.io rooms)

// HTTP Server
fastify.get('/', async (request, reply) => {
    return { hello: 'world' };
});

// Socket.io for Control Channel
const io = new Server(fastify.server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 1e7 // 10MB
});

projectManager.on('updated', () => {
    io.emit('projects_updated');
});

const agents = new Map<string, Agent>();
const deviceOwners = new Map<string, string>(); // deviceId -> socketId

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Send current state to new client (Frontend)
    socket.emit('agents_updated', Array.from(agents.values()));
    socket.emit('occupancy_updated', Object.fromEntries(deviceOwners));

    socket.on('register_agent', (agentInfo: Agent) => {
        console.log('Agent registered:', agentInfo.id);
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

    let streamDataCount = 0;
    socket.on('stream_data', (data: { deviceId: string, chunk: Buffer }) => {
        const agentId = socket.data.agentId;
        if (agentId) {
            const room = `stream:${agentId}:${data.deviceId}`;
            const roomMembers = io.sockets.adapter.rooms.get(room);
            streamDataCount++;
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
        // Broadcast log to all clients (or filter by subscription in future)
        io.emit('job_log', data);
    });

    socket.on('job_status', (data: { jobId: string, status: 'completed' | 'failed' }) => {
        jobManager.updateJobStatus(data.jobId, data.status);
        const job = jobManager.getJob(data.jobId);
        if (job) io.emit('job_updated', job);
    });

    // --- DEVICE CONTROL RELAY ---
    const forwardToAgent = (event: string, data: any) => {
        // data must contain agentId
        const agentSocket = Array.from(io.sockets.sockets.values()).find(s => s.data?.agentId === data.agentId);
        if (agentSocket) {
            console.log(`[Server] Relay ${event} to agent ${data.agentId} (Socket: ${agentSocket.id})`);
            console.log(`[Server] Data:`, JSON.stringify(data));
            agentSocket.emit(event, data);
        } else {
            console.log(`[Server] FAILED to relay ${event}: Agent ${data.agentId} not found.`);
        }
    };

    const forwardToFrontend = (event: string, data: any) => {
        // For now broadcast, later could be room based
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

const start = async () => {
    try {
        await fastify.listen({ port: 3000, host: '0.0.0.0' });
        console.log('Server listening on http://localhost:3000');
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
