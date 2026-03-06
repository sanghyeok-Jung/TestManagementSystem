import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs-extra';
import AdmZip from 'adm-zip';
import { pipeline } from 'stream/promises';
import { Server } from 'socket.io';
import { JobManager } from '../jobs';

const UPLOAD_DIR = path.join(__dirname, '../../uploads');

export default async function jobRoutes(fastify: FastifyInstance, options: { jobManager: JobManager, io: Server }) {
    const { jobManager, io } = options;

    // Legacy Upload Endpoint (Keep for ADB)
    fastify.post('/api/upload', async (req, reply) => {
        const data = await req.file();
        if (!data) {
            return reply.status(400).send({ error: 'No file uploaded' });
        }

        const filename = `${Date.now()}-${data.filename}`;
        const filepath = path.join(UPLOAD_DIR, filename);

        await fs.ensureDir(UPLOAD_DIR);
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
}
