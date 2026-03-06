import { FastifyInstance } from 'fastify';
import { ScheduleManager } from '../scheduler';

export default async function scheduleRoutes(fastify: FastifyInstance, options: { scheduleManager: ScheduleManager }) {
    const { scheduleManager } = options;

    fastify.get('/api/schedules', async (req, reply) => {
        return scheduleManager.getAll();
    });

    fastify.post('/api/schedules', async (req, reply) => {
        const data = req.body as Parameters<typeof scheduleManager.create>[0];
        if (!data.name || !data.scriptId || !data.cronExpression || !data.command) {
            return reply.status(400).send({ error: 'Missing required fields' });
        }
        const schedule = scheduleManager.create(data);
        return { success: true, schedule };
    });

    fastify.put('/api/schedules/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const updates = req.body as Parameters<typeof scheduleManager.update>[1];
        const schedule = scheduleManager.update(id, updates);
        if (!schedule) {
            return reply.status(404).send({ error: 'Schedule not found' });
        }
        return { success: true, schedule };
    });

    fastify.delete('/api/schedules/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const success = scheduleManager.delete(id);
        if (!success) {
            return reply.status(404).send({ error: 'Schedule not found' });
        }
        return { success: true };
    });
}
