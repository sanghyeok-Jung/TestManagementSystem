export class JobQueue {
    private queues = new Map<string, Promise<void>>();
    private lengths = new Map<string, number>();

    public onQueueUpdate?: (targetId: string, length: number) => void;

    private emitUpdate(targetId: string) {
        if (this.onQueueUpdate) {
            this.onQueueUpdate(targetId, this.lengths.get(targetId) || 0);
        }
    }

    /**
     * Enqueues a task to be executed sequentially for a given target.
     * @param targetId The ID of the target (e.g., deviceId or 'agent-vm').
     * @param task A function that returns a Promise representing the task to execute.
     */
    enqueue(targetId: string, task: () => Promise<void>): void {
        const currentQueue = this.queues.get(targetId) || Promise.resolve();

        // Increase length
        const currentLength = this.lengths.get(targetId) || 0;
        this.lengths.set(targetId, currentLength + 1);
        this.emitUpdate(targetId);

        // Chain the new task onto the existing queue
        const nextQueue = currentQueue.then(async () => {
            try {
                // Task is starting, it is no longer waiting in the queue, but occupies the target
                // For simplicity, we consider a running task as NOT in the queue (or we can keep it as 1 until done).
                // Let's decrement when the task starts so "Queue" strictly means "Waiting".
                const len = this.lengths.get(targetId) || 1;
                this.lengths.set(targetId, Math.max(0, len - 1));
                this.emitUpdate(targetId);

                await task();
            } catch (error) {
                console.error(`[JobQueue] Error executing task for target ${targetId}:`, error);
            }
        });

        // Update the queue reference
        this.queues.set(targetId, nextQueue);

        // Optional: Clean up the queue if it's empty to prevent memory leaks over very long uptimes,
        // but since it resolves and gets replaced, memory leak isn't a huge issue unless we
        // spawn millions of queues. We can optionally attach a finally to clean it up if it's the last one.
        nextQueue.finally(() => {
            if (this.queues.get(targetId) === nextQueue) {
                this.queues.delete(targetId);
            }
        });
    }
}
