import execa from 'execa';
import { Socket } from 'socket.io-client';

class StreamSession {
    private active = true;
    private process: execa.ExecaChildProcess | null = null;
    private currentRotation: number = -1; // -1 = not yet determined

    constructor(
        private deviceId: string,
        private agentId: string,
        private socket: Socket
    ) { }

    private async getRealDimensions(): Promise<{ w: number, h: number, rotation: number }> {
        try {
            const { stdout } = await execa('adb', ['-s', this.deviceId, 'shell', 'dumpsys display']);
            const overrideIdx = stdout.indexOf('mOverrideDisplayInfo');
            if (overrideIdx !== -1) {
                // Use 2000 chars — enough to pass the long modes[] list and reach "rotation N"
                const block = stdout.slice(overrideIdx, overrideIdx + 2000);
                const realMatch = block.match(/real (\d+) x (\d+)/);
                const rotMatch = block.match(/rotation (\d)/);
                if (realMatch) {
                    const w = parseInt(realMatch[1]);
                    const h = parseInt(realMatch[2]);
                    // Infer rotation from w/h when regex can't reach the rotation field
                    const rotation = rotMatch ? parseInt(rotMatch[1]) : (w > h ? 1 : 0);
                    return { w, h, rotation };
                }
            }
        } catch (e) { }

        // Fallback: wm size (always portrait base dims) + infer orientation
        try {
            const { stdout } = await execa('adb', ['-s', this.deviceId, 'shell', 'wm size']);
            const match = stdout.match(/Override size: (\d+)x(\d+)/) || stdout.match(/Physical size: (\d+)x(\d+)/);
            if (match) {
                const w = parseInt(match[1]);
                const h = parseInt(match[2]);
                return { w, h, rotation: w > h ? 1 : 0 };
            }
        } catch (e) { }

        return { w: 720, h: 1560, rotation: 0 };
    }

    private async calculateStreamSize(): Promise<string> {
        const { w, h, rotation } = await this.getRealDimensions();
        this.currentRotation = rotation;

        const scale = 360 / Math.min(w, h);
        let sw = Math.round(w * scale);
        let sh = Math.round(h * scale);
        // Align to 16 pixels for encoder compatibility
        sw = Math.round(sw / 16) * 16;
        sh = Math.round(sh / 16) * 16;
        return `${sw}x${sh}`;
    }


    async start() {
        console.log(`[StreamSession] Starting session for ${this.deviceId}`);

        // Auto-wake device
        try {
            await execa('adb', ['-s', this.deviceId, 'shell', 'input', 'keyevent', '224']);
        } catch (e) { }

        // Initial preview
        this.sendPreview();

        // Main loop
        while (this.active) {
            try {
                const streamSize = await this.calculateStreamSize();
                console.log(`[StreamSession] Determined size: ${streamSize} (Rot: ${this.currentRotation})`);
                await this.runProcess(streamSize);
            } catch (e) {
                console.error(`[StreamSession] Error in runProcess:`, e);
            }

            if (!this.active) break;

            console.log(`[StreamSession] Restarting stream for ${this.deviceId} in 300ms...`);
            await new Promise(r => setTimeout(r, 300));

            // Re-wake before restart
            try {
                await execa('adb', ['-s', this.deviceId, 'shell', 'input', 'keyevent', '224']);
            } catch (e) { }
            // Re-send preview on restart so client isn't staring at black screen
            if (this.active) this.sendPreview();
        }

        console.log(`[StreamSession] Session ended for ${this.deviceId}`);
    }

    async stop() {
        this.active = false;
        if (this.process) {
            console.log(`[StreamSession] Killing process for ${this.deviceId}`);
            this.process.kill();
            try { await this.process; } catch (e) { }
            this.process = null;
        }
    }

    private async runProcess(size: string) {
        console.log(`[StreamSession] Spawning screenrecord for ${this.deviceId}...`);

        this.process = execa('adb', [
            '-s', this.deviceId,
            'shell', 'screenrecord',
            '--output-format=h264',
            '--bit-rate', '1000000',  // 1Mbps: sufficient quality at 360p
            '--size', size,
            '--time-limit', '45',     // 45s: balance between I-frame refresh and reconnect frequency
            '-'
        ], {
            stdio: ['ignore', 'pipe', 'pipe'],
            buffer: false
        });

        if (this.process.stdout) {
            this.process.stdout.on('data', (chunk: Buffer) => {
                if (this.active) {
                    this.socket.emit('stream_data', { deviceId: this.deviceId, chunk });
                }
            });
        }

        if (this.process.stderr) {
            this.process.stderr.on('data', (data) => {
                console.error(`[StreamSession] screenrecord stderr: ${data.toString()}`);
            });
        }

        const rotationPollInterval = setInterval(async () => {
            if (!this.active || !this.process) {
                clearInterval(rotationPollInterval);
                return;
            }
            try {
                const { rotation: newRotation } = await this.getRealDimensions();
                if (this.currentRotation !== -1 && newRotation !== this.currentRotation) {
                    console.log(`[StreamSession] Rotation changed ${this.currentRotation}→${newRotation}. Restarting.`);
                    this.currentRotation = newRotation;
                    this.socket.emit('stream_reset', { deviceId: this.deviceId });
                    this.process.kill('SIGKILL');
                }
            } catch (e) { }
        }, 1000);

        try {
            await this.process;
        } catch (e: any) {
            // Ignore valid kills
            if (e.signal !== 'SIGTERM' && e.signal !== 'SIGINT' && e.signal !== 'SIGKILL' && !e.killed) {
                console.error(`[StreamSession] Process error:`, e.message);
            }
        } finally {
            clearInterval(rotationPollInterval);
            this.process = null;
        }
    }

    private async sendPreview() {
        if (!this.active) return;
        try {
            const { stdout } = await execa('adb', ['-s', this.deviceId, 'exec-out', 'screencap', '-p'], {
                encoding: null,
                maxBuffer: 10 * 1024 * 1024
            });
            if (stdout && stdout.length > 0 && this.active) {
                const base64 = (stdout as unknown as Buffer).toString('base64');
                this.socket.emit('stream_preview', {
                    deviceId: this.deviceId,
                    image: `data:image/png;base64,${base64}`
                });
            }
        } catch (e) {
            console.warn(`[StreamSession] Preview capture failed for ${this.deviceId}`);
        }
    }
}

export class Streamer {
    private sessions = new Map<string, StreamSession>();
    private agentId: string;
    private socket: Socket;

    constructor(agentId: string, socket: Socket) {
        this.agentId = agentId;
        this.socket = socket;
    }

    async start(deviceId: string) {
        if (this.sessions.has(deviceId)) {
            console.log(`[Streamer] Session already exists for ${deviceId}, restarting...`);
            await this.stop(deviceId);
        }

        const session = new StreamSession(deviceId, this.agentId, this.socket);
        this.sessions.set(deviceId, session);

        // Start session in background (it runs its own loop)
        session.start().catch(e => {
            console.error(`[Streamer] Session crashed for ${deviceId}:`, e);
            this.sessions.delete(deviceId);
        });
    }

    async stop(deviceId: string) {
        const session = this.sessions.get(deviceId);
        if (session) {
            await session.stop();
            this.sessions.delete(deviceId);
        }
    }
}
