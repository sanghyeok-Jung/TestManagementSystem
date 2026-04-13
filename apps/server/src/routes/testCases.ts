import { FastifyInstance } from 'fastify';
import { TestCaseManager } from '../testCases';
import { TestCaseCreateInput, TestCaseUpdateInput } from '@qa/types';

export default async function testCaseRoutes(fastify: FastifyInstance, options: { testCaseManager: TestCaseManager }) {
    const { testCaseManager } = options;

    fastify.get('/api/test-cases', async (req, reply) => {
        return testCaseManager.getAll();
    });

    fastify.post('/api/test-cases', async (req, reply) => {
        const data = req.body as TestCaseCreateInput;
        if (!data || !data.title || !data.steps || !data.expectedResult || !data.status) {
            return reply.status(400).send({ error: 'Missing required fields' });
        }

        try {
            const testCase = testCaseManager.create(data);
            return testCase;
        } catch (error) {
            req.log.error(error);
            return reply.status(500).send({ error: 'Failed to create test case' });
        }
    });

    fastify.put('/api/test-cases/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const data = req.body as TestCaseUpdateInput;

        try {
            const updatedTestCase = testCaseManager.update(id, data);
            if (!updatedTestCase) {
                return reply.status(404).send({ error: 'Test case not found' });
            }
            return updatedTestCase;
        } catch (error) {
            req.log.error(error);
            return reply.status(500).send({ error: 'Failed to update test case' });
        }
    });

    fastify.delete('/api/test-cases/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const success = testCaseManager.delete(id);
        if (!success) {
            return reply.status(404).send({ error: 'Test case not found' });
        }
        return { success: true };
    });

    fastify.post('/api/test-cases/:id/restore', async (req, reply) => {
        const { id } = req.params as { id: string };
        const success = testCaseManager.restore(id);
        if (!success) {
            return reply.status(404).send({ error: 'Test case not found' });
        }
        return { success: true };
    });

    fastify.delete('/api/test-cases/:id/hard', async (req, reply) => {
        const { id } = req.params as { id: string };
        const success = testCaseManager.hardDelete(id);
        if (!success) {
            return reply.status(404).send({ error: 'Test case not found' });
        }
        return { success: true };
    });
}
