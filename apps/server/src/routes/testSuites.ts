import { FastifyInstance } from 'fastify';
import { TestSuiteManager } from '../testSuites';
import { TestSuiteCreateInput, TestSuiteUpdateInput } from '@qa/types';

export default async function testSuiteRoutes(fastify: FastifyInstance, options: { testSuiteManager: TestSuiteManager }) {
    const { testSuiteManager } = options;

    fastify.get('/api/test-suites', async (req, reply) => {
        return testSuiteManager.getAll();
    });

    fastify.post('/api/test-suites', async (req, reply) => {
        const data = req.body as TestSuiteCreateInput;
        if (!data || !data.name) {
            return reply.status(400).send({ error: 'Suite name is required' });
        }

        try {
            const suite = testSuiteManager.create(data);
            return suite;
        } catch (error) {
            req.log.error(error);
            return reply.status(500).send({ error: 'Failed to create test suite' });
        }
    });

    fastify.put('/api/test-suites/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const data = req.body as TestSuiteUpdateInput;

        try {
            const updatedSuite = testSuiteManager.update(id, data);
            if (!updatedSuite) {
                return reply.status(404).send({ error: 'Test suite not found' });
            }
            return updatedSuite;
        } catch (error) {
            req.log.error(error);
            return reply.status(500).send({ error: 'Failed to update test suite' });
        }
    });

    fastify.delete('/api/test-suites/:id', async (req, reply) => {
        const { id } = req.params as { id: string };
        const success = testSuiteManager.delete(id);
        if (!success) {
            return reply.status(404).send({ error: 'Test suite not found' });
        }
        return { success: true };
    });

    fastify.post('/api/test-suites/:id/restore', async (req, reply) => {
        const { id } = req.params as { id: string };
        const success = testSuiteManager.restore(id);
        if (!success) {
            return reply.status(404).send({ error: 'Test suite not found' });
        }
        return { success: true };
    });

    fastify.delete('/api/test-suites/:id/hard', async (req, reply) => {
        const { id } = req.params as { id: string };
        const success = testSuiteManager.hardDelete(id);
        if (!success) {
            return reply.status(404).send({ error: 'Test suite not found' });
        }
        return { success: true };
    });
}
