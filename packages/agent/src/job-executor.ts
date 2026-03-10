import execa from 'execa';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import extract from 'extract-zip';
import axios from 'axios';

export class JobExecutor {
    private activeJobs = new Map<string, execa.ExecaChildProcess>();

    async startJob(jobId: string, downloadUrl: string, command: string, workDirName: string, deviceId: string) {
        console.log(`Starting job ${jobId} on device ${deviceId}: ${command}`);

        // 1. Create Temp Directory
        const tmpDir = path.join(os.tmpdir(), 'qa-agent-jobs', workDirName);
        await fs.ensureDir(tmpDir);
        await fs.emptyDir(tmpDir);

        try {
            // 2. Download Script
            console.log(`Downloading script from ${downloadUrl}...`);
            const zipPath = path.join(tmpDir, 'script.zip');
            const response = await axios({
                method: 'GET',
                url: downloadUrl,
                responseType: 'arraybuffer'
            });
            await fs.writeFile(zipPath, Buffer.from(response.data as ArrayBuffer));

            // 3. Unzip
            console.log(`Unzipping to ${tmpDir}...`);
            await extract(zipPath, { dir: tmpDir });

            // Check for single top-level directory
            const items = await fs.readdir(tmpDir);
            const validItems = items.filter(item => item !== 'script.zip' && item !== '__MACOSX' && !item.startsWith('.'));

            let workingDir = tmpDir;
            if (validItems.length === 1) {
                const potentialDir = path.join(tmpDir, validItems[0]);
                const stats = await fs.stat(potentialDir);
                if (stats.isDirectory()) {
                    console.log(`Detected single top-level directory: ${validItems[0]}. Entering...`);
                    workingDir = potentialDir;
                }
            }

            console.log(`Working directory: ${workingDir}`);
            console.log('Files in working directory:', await fs.readdir(workingDir));

            // Setup environment variables for execution
            const execEnv: NodeJS.ProcessEnv = {
                ...process.env
            };
            if (deviceId) {
                execEnv.DEVICE_ID = deviceId;
            }

            // 4. Calculate Command and CWD
            // Assumption: command is like "npm test" or "python main.py"
            // If package.json exists, we might need npm install
            if (fs.existsSync(path.join(workingDir, 'package.json'))) {
                console.log('Detected package.json. Removing existing node_modules and running npm install...');
                const nodeModulesPath = path.join(workingDir, 'node_modules');
                if (fs.existsSync(nodeModulesPath)) {
                    await fs.remove(nodeModulesPath);
                    console.log('Removed bundled node_modules to avoid cross-platform compatibility issues.');
                }
                await execa('npm', ['install'], { cwd: workingDir, env: execEnv });
            } else {
                console.log(`No package.json found in ${workingDir}`);
            }

            // Fix executable permissions inside node_modules/.bin if present
            // Zip extraction can sometimes drop UNIX executable bits
            const binDir = path.join(workingDir, 'node_modules', '.bin');
            if (fs.existsSync(binDir)) {
                console.log('Fixing executable permissions in node_modules/.bin...');
                await execa('chmod', ['-R', '+x', binDir]);
            }

            // 5. Execute
            console.log(`Executing: ${command}`);
            const [cmd, ...args] = command.split(' ');
            const subprocess = execa(cmd, args, { cwd: workingDir, env: execEnv, shell: true });

            this.activeJobs.set(jobId, subprocess);

            subprocess.stdout?.on('data', (data) => {
                const log = data.toString();
                // console.log(`[Job ${jobId}] stdout: ${log}`);
                this.emitLog(jobId, 'stdout', log);
            });

            subprocess.stderr?.on('data', (data) => {
                const log = data.toString();
                // console.error(`[Job ${jobId}] stderr: ${log}`);
                this.emitLog(jobId, 'stderr', log);
            });

            await subprocess;
            console.log(`Job ${jobId} completed`);
            this.emitLog(jobId, 'system', `Job function completed with exit code ${subprocess.exitCode}`);
            if (this.onStatusChange) this.onStatusChange(jobId, 'completed');

        } catch (error: any) {
            console.error(`Job ${jobId} failed:`, error);
            this.emitLog(jobId, 'stderr', `Job failed: ${error.message}`);
            if (this.onStatusChange) this.onStatusChange(jobId, 'failed');
        } finally {
            this.activeJobs.delete(jobId);
        }
    }

    private emitLog(jobId: string, type: 'stdout' | 'stderr' | 'system', message: string) {
        // We need a way to emit back to socket.
        // Since JobExecutor doesn't receive socket in constructor, we can accept a callback or emit event.
        // For simplicity, let's add a callback to startJob or constructor.
        if (this.onLog) {
            this.onLog(jobId, type, message);
        }
    }

    public onLog?: (jobId: string, type: 'stdout' | 'stderr' | 'system', message: string) => void;
    public onStatusChange?: (jobId: string, status: 'completed' | 'failed') => void;

    stopJob(jobId: string) {
        const job = this.activeJobs.get(jobId);
        if (job) {
            job.kill();
            this.activeJobs.delete(jobId);
        }
    }
}
