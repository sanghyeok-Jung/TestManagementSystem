import execa from 'execa';

export class LogcatSession {
    private process: execa.ExecaChildProcess | null = null;
    private deviceId: string;
    public onLog?: (data: string) => void;
    private buffer: string[] = [];
    private flushTimer: NodeJS.Timeout | null = null;

    constructor(deviceId: string) {
        this.deviceId = deviceId;
    }

    start() {
        if (this.process) return;

        console.log(`[Logcat] Starting logcat for ${this.deviceId}`);
        this.process = execa('adb', ['-s', this.deviceId, 'logcat', '-v', 'threadtime'], {
            stdout: 'pipe',
            stderr: 'pipe'
        });

        this.process.stdout?.on('data', (data) => {
            this.handleData(data.toString());
        });

        this.process.stderr?.on('data', (data) => {
            this.handleData(data.toString());
        });

        this.process.on('exit', (code) => {
            console.log(`[Logcat] Process exited with code ${code}`);
            this.stop().catch(() => { });
        });
    }

    private handleData(data: string) {
        this.buffer.push(data);
        if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => this.flush(), 300);
        } else if (this.buffer.length > 2000) {
            // Force flush if buffer gets too large
            this.flush();
        }
    }

    private flush() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }

        if (this.buffer.length > 0) {
            this.onLog?.(this.buffer.join(''));
            this.buffer = [];
        }
    }

    async stop() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.process) {
            this.process.kill();
            try {
                await this.process;
            } catch (e) {
                // Ignore exit errors
            }
            this.process = null;
        }
        this.buffer = [];
    }

    async clear() {
        try {
            await execa('adb', ['-s', this.deviceId, 'logcat', '-c']);
        } catch (error: any) {
            console.error(`[Logcat] Failed to clear for ${this.deviceId}:`, error.message);
            throw error;
        }
    }
}
