import fs from 'fs-extra';
import path from 'path';
import * as cron from 'node-cron';
import { TestSchedule } from '@qa/types';
import { EventEmitter } from 'events';
import { JobManager } from './jobs';
import { Server } from 'socket.io';

export class ScheduleManager extends EventEmitter {
    private storageFile: string;
    private schedules: TestSchedule[] = [];
    private cronTasks: Map<string, cron.ScheduledTask> = new Map();
    private io: Server;
    private jobManager: JobManager;

    constructor(io: Server, jobManager: JobManager) {
        super();
        this.io = io;
        this.jobManager = jobManager;
        this.storageFile = path.join(__dirname, '../storage/schedules.json');
        this.init();
    }

    private init() {
        fs.ensureDirSync(path.dirname(this.storageFile));

        if (fs.existsSync(this.storageFile)) {
            try {
                this.schedules = fs.readJsonSync(this.storageFile);
            } catch (error) {
                console.error('Failed to load schedules:', error);
                this.schedules = [];
            }
        }

        // Register existing (active) schedules to cron job
        this.schedules.forEach(schedule => {
            if (schedule.isActive) {
                this.scheduleCronJob(schedule);
            }
        });
    }

    private save() {
        fs.writeJsonSync(this.storageFile, this.schedules, { spaces: 2 });
        this.emit('schedules_updated', this.schedules);
    }

    getAll(): TestSchedule[] {
        return this.schedules;
    }

    get(id: string): TestSchedule | undefined {
        return this.schedules.find(s => s.id === id);
    }

    create(data: Omit<TestSchedule, 'id' | 'createdAt' | 'updatedAt' | 'lastRunAt' | 'nextRunAt'>): TestSchedule {
        const schedule: TestSchedule = {
            ...data,
            id: `sched-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        this.schedules.push(schedule);
        if (schedule.isActive) {
            this.scheduleCronJob(schedule);
        }
        this.save();
        return schedule;
    }

    update(id: string, updates: Partial<TestSchedule>): TestSchedule | null {
        const index = this.schedules.findIndex(s => s.id === id);
        if (index === -1) return null;

        const existingSchedule = this.schedules[index];
        const updatedSchedule = {
            ...existingSchedule,
            ...updates,
            updatedAt: Date.now()
        };

        // Cron task needs to be updated when cron expression or is_active changes
        const needsReschedule = existingSchedule.cronExpression !== updatedSchedule.cronExpression ||
            existingSchedule.isActive !== updatedSchedule.isActive;

        this.schedules[index] = updatedSchedule;

        if (needsReschedule) {
            this.cancelCronJob(id);
            if (updatedSchedule.isActive) {
                this.scheduleCronJob(updatedSchedule);
            }
        }

        this.save();
        return updatedSchedule;
    }

    delete(id: string): boolean {
        const index = this.schedules.findIndex(s => s.id === id);
        if (index === -1) return false;

        this.cancelCronJob(id);
        this.schedules.splice(index, 1);
        this.save();
        return true;
    }

    private scheduleCronJob(schedule: TestSchedule) {
        // node-cron validation (simple validation, more sophisticated validation and error handling are recommended in production)
        if (!cron.validate(schedule.cronExpression)) {
            console.error(`Invalid cron expression for schedule ${schedule.id}: ${schedule.cronExpression}`);
            return;
        }

        const task = cron.schedule(schedule.cronExpression, async () => {
            console.log(`[Scheduler] Running schedule: ${schedule.name} (${schedule.id})`);

            const now = Date.now();
            this.update(schedule.id, {
                lastRunAt: now,
                // nextRunAt: Can be calculated but is not strictly necessary in node-cron
            });

            // Create a job for each target Agent/Device
            for (const target of schedule.targets) {
                const command = schedule.command; // Use the configured command for the schedule
                const job = this.jobManager.createJob(schedule.scriptId, target.agentId, command, target.deviceId || undefined);

                // Send start_job event to Agent
                const agentSocket = Array.from(this.io.sockets.sockets.values()).find(s => s.data.agentId === target.agentId);
                if (agentSocket) {
                    agentSocket.emit('start_job', {
                        jobId: job.id,
                        scriptId: schedule.scriptId,
                        deviceId: target.deviceId || undefined,
                        command,
                        downloadUrl: `http://localhost:3000/api/download/${schedule.scriptId}`
                    });
                }
            }
        });

        this.cronTasks.set(schedule.id, task);
    }

    private cancelCronJob(id: string) {
        const task = this.cronTasks.get(id);
        if (task) {
            task.stop();
            this.cronTasks.delete(id);
        }
    }
}
