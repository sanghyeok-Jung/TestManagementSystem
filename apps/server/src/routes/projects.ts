import { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs-extra';
import { ProjectManager } from '../projects';

const UPLOAD_DIR = path.join(__dirname, '../../uploads');

export default async function projectRoutes(fastify: FastifyInstance, options: { projectManager: ProjectManager }) {
    const { projectManager } = options;

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
}
