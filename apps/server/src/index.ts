import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fs from 'fs-extra';
import path from 'path';
import { Server } from 'socket.io';
import { Agent, Device } from '@qa/types';

import { ProjectManager } from './projects';
import { JobManager } from './jobs';
import { ScheduleManager } from './scheduler';
import { setupSocketHandlers } from './socket';

import projectRoutes from './routes/projects';
import jobRoutes from './routes/jobs';
import scheduleRoutes from './routes/schedules';

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

// Socket.io for Control Channel
const io = new Server(fastify.server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 1e7 // 10MB
});

const scheduleManager = new ScheduleManager(io, jobManager);

const agents = new Map<string, Agent>();
const deviceOwners = new Map<string, string>(); // deviceId -> socketId

// Event listeners for cross-manager updates
projectManager.on('updated', () => {
    io.emit('projects_updated');
});

// Setup Socket Handlers
setupSocketHandlers(io, agents, deviceOwners, jobManager);

// Register HTTP Routes
fastify.register(async (instance) => {
    await projectRoutes(instance, { projectManager });
    await jobRoutes(instance, { jobManager, io });
    await scheduleRoutes(instance, { scheduleManager });
});

fastify.get('/', async (request, reply) => {
    return { hello: 'qa-lab-orchestrator' };
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
