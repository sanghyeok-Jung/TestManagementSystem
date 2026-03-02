import fs from 'fs-extra';
import path from 'path';
import { TestJob, LogEntry } from '@qa/types';
import { EventEmitter } from 'events';

export class JobManager extends EventEmitter {
    private storageFile: string;
    private logsDir: string;
    private jobs: TestJob[] = [];

    constructor() {
        super();
        this.storageFile = path.join(__dirname, '../storage/jobs.json');
        this.logsDir = path.join(__dirname, '../uploads/jobs/logs');
        this.init();
    }

    private init() {
        fs.ensureDirSync(path.dirname(this.storageFile));
        fs.ensureDirSync(this.logsDir);

        if (fs.existsSync(this.storageFile)) {
            try {
                this.jobs = fs.readJsonSync(this.storageFile);
            } catch (error) {
                console.error('Failed to load jobs:', error);
                this.jobs = [];
            }
        }
    }

    private save() {
        fs.writeJsonSync(this.storageFile, this.jobs, { spaces: 2 });
    }

    // --- Job Management ---

    getAll(): TestJob[] {
        return this.jobs.sort((a, b) => b.createdAt - a.createdAt);
    }

    getJobsForDevice(deviceId: string): TestJob[] {
        return this.jobs.filter(j => j.targetDeviceId === deviceId).sort((a, b) => b.createdAt - a.createdAt);
    }

    getJob(id: string): TestJob | undefined {
        return this.jobs.find(j => j.id === id);
    }

    createJob(scriptId: string, agentId: string, command: string, deviceId?: string): TestJob {
        const job: TestJob = {
            id: `job-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            scriptId,
            targetDeviceId: deviceId,
            targetAgentId: agentId,
            command,
            status: 'running',
            createdAt: Date.now()
        };

        this.jobs.push(job);
        this.save();
        this.emit('job_created', job);
        return job;
    }

    updateJobStatus(id: string, status: TestJob['status']) {
        const job = this.getJob(id);
        if (job) {
            job.status = status;
            if (status === 'completed' || status === 'failed') {
                job.completedAt = Date.now();
            }
            this.save();
            this.emit('job_updated', job);
        }
    }

    // --- Log Management ---

    private getLogFilePath(jobId: string): string {
        return path.join(this.logsDir, `${jobId}.log`);
    }

    async appendLog(logEntry: LogEntry) {
        const logPath = this.getLogFilePath(logEntry.jobId);
        const logLine = JSON.stringify(logEntry) + '\n';

        try {
            await fs.appendFile(logPath, logLine, 'utf-8');
            this.emit('log_appended', logEntry);
        } catch (error) {
            console.error(`Failed to append log for job ${logEntry.jobId}:`, error);
        }
    }

    async getJobLogs(jobId: string): Promise<LogEntry[]> {
        const logPath = this.getLogFilePath(jobId);
        if (!fs.existsSync(logPath)) return [];

        try {
            const content = await fs.readFile(logPath, 'utf-8');
            const lines = content.trim().split('\n');
            return lines.filter(line => line.length > 0).map(line => {
                try {
                    return JSON.parse(line) as LogEntry;
                } catch (e) {
                    return null;
                }
            }).filter(Boolean) as LogEntry[];
        } catch (error) {
            console.error(`Failed to read logs for job ${jobId}:`, error);
            return [];
        }
    }
}
