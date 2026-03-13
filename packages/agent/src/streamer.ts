import execa from 'execa';
import { Socket } from 'socket.io-client';
import path from 'path';
import fs from 'fs';
import { IDeviceManager } from './handlers/device-manager';

class StreamSession {
    private active = true;
    private process: execa.ExecaChildProcess | null = null;
    private currentRotation: number = -1; // -1 = not yet determined

    constructor(
        private deviceId: string,
        private agentId: string,
        private socket: Socket,
        private platform: 'android' | 'ios',
        private manager: IDeviceManager
    ) { }

    private async getRealDimensions(): Promise<{ w: number, h: number, rotation: number }> {
        try {
            const metadata = await this.manager.getMetadata(this.deviceId);
            if (metadata) {
                return { w: metadata.width, h: metadata.height, rotation: metadata.rotation };
            }
        } catch (e) {
            console.error(`[StreamSession] Failed to get metadata for ${this.deviceId}:`, e);
        }

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
        if (this.platform === 'android') {
            try {
                await execa('adb', ['-s', this.deviceId, 'shell', 'input', 'keyevent', '224']);
            } catch (e) { }
        }

        // Initial preview
        this.sendPreview();

        let retryCount = 0;
        let lastStartTime = 0;

        // Main loop
        while (this.active) {
            lastStartTime = Date.now();
            try {
                const streamSize = await this.calculateStreamSize();
                console.log(`[StreamSession] Determined size: ${streamSize} (Rot: ${this.currentRotation})`);
                await this.runProcess(streamSize);
            } catch (e) {
                console.error(`[StreamSession] Error in runProcess:`, e);
            }

            if (!this.active) break;

            const uptime = Date.now() - lastStartTime;
            if (uptime > 5000) {
                // If it stayed alive for > 5s, it was likely a successful connection that later dropped
                retryCount = 0;
            } else {
                retryCount++;
            }

            if (retryCount > 15) {
                console.error(`[StreamSession] Maximum restart retries reached for ${this.deviceId}. Halting stream.`);
                this.socket.emit('stream_error', { deviceId: this.deviceId, message: 'Stream failed to connect after multiple retries.' });
                break;
            }

            const backoffDelay = Math.min(500 * Math.pow(1.5, retryCount - 1), 5000);
            if (retryCount > 0) {
                 console.log(`[StreamSession] Stream died quickly. Restarting for ${this.deviceId} in ${Math.round(backoffDelay)}ms (Attempt ${retryCount}/15)...`);
            } else {
                 console.log(`[StreamSession] Restarting stream for ${this.deviceId} in 300ms...`);
            }
            
            await new Promise(r => setTimeout(r, retryCount > 0 ? backoffDelay : 300));

            // Re-wake before restart
            if (this.platform === 'android') {
                try {
                    await execa('adb', ['-s', this.deviceId, 'shell', 'input', 'keyevent', '224']);
                } catch (e) { }
            }
            // Re-send preview on restart so client isn't staring at black screen
            if (this.active && retryCount === 0) this.sendPreview();
        }

        console.log(`[StreamSession] Session ended for ${this.deviceId}`);
    }

    async stop() {
        this.active = false;
        // Destroy MJPEG HTTP request if active (iOS)
        if ((this as any)._mjpegRequest) {
            (this as any)._mjpegRequest.destroy();
            (this as any)._mjpegRequest = null;
        }
        if (this.process) {
            console.log(`[StreamSession] Killing process for ${this.deviceId}`);
            this.process.kill();
            try { await this.process; } catch (e) { }
            this.process = null;
        }
    }

    private async findIosBinary(): Promise<string> {
        try { await execa('ios', ['--version']); return 'ios'; } catch (e) { }
        try { await execa('go-ios', ['--version']); return 'go-ios'; } catch (e) { }
        const arch = process.arch === 'x64' ? 'amd64' : process.arch;
        const plat = process.platform === 'darwin' ? 'darwin' : process.platform;
        const localPaths = [
            path.resolve(process.cwd(), `node_modules/go-ios/dist/go-ios-${plat}-${arch}_${plat}_${arch}/ios`),
            path.resolve(process.cwd(), `../node_modules/go-ios/dist/go-ios-${plat}-${arch}_${plat}_${arch}/ios`),
            path.resolve(__dirname, `../../node_modules/go-ios/dist/go-ios-${plat}-${arch}_${plat}_${arch}/ios`),
        ];
        for (const p of localPaths) {
            if (fs.existsSync(p)) return p;
        }
        throw new Error('go-ios binary not found. Please run: brew install danielpaulus/tap/go-ios');
    }

    /**
     * iOS streaming: connect to WDA's MJPEG server and parse individual JPEG frames
     * from the multipart boundary HTTP response.
     */
    private async runIosMjpegStream() {
        // Get the MJPEG port from the device manager
        if (!this.manager.getMjpegPort) {
            console.error('[StreamSession] Device manager does not support getMjpegPort');
            return;
        }

        const mjpegPort = await this.manager.getMjpegPort(this.deviceId);
        if (!mjpegPort) {
            console.error('[StreamSession] Could not get MJPEG port for', this.deviceId);
            return;
        }

        const url = `http://127.0.0.1:${mjpegPort}`;
        console.log(`[StreamSession] Connecting to WDA MJPEG stream at ${url}`);

        const http = await import('http');

        return new Promise<void>((resolve) => {
            const req = http.get(url, (res) => {
                if (res.statusCode !== 200) {
                    console.error(`[StreamSession] MJPEG server returned status ${res.statusCode}`);
                    resolve();
                    return;
                }

                let buffer = Buffer.alloc(0);
                const BOUNDARY = Buffer.from('--BoundaryString');
                const CRLFCRLF = Buffer.from('\r\n\r\n'); // separates headers from jpeg data
                let frameCount = 0;

                res.on('data', (chunk: Buffer) => {
                    if (!this.active) {
                        req.destroy();
                        return;
                    }

                    buffer = Buffer.concat([buffer, chunk]);

                    // Parse frames from the multipart stream
                    while (true) {
                        const boundaryIdx = buffer.indexOf(BOUNDARY);
                        if (boundaryIdx === -1) break;

                        // Find the next boundary to know where this frame ends
                        const nextBoundaryIdx = buffer.indexOf(BOUNDARY, boundaryIdx + BOUNDARY.length);
                        if (nextBoundaryIdx === -1) break; // Wait for more data

                        // Extract the frame section (between two boundaries)
                        const frameSection = buffer.slice(boundaryIdx + BOUNDARY.length, nextBoundaryIdx);

                        // Find the header/body separator
                        const headerEnd = frameSection.indexOf(CRLFCRLF);
                        if (headerEnd !== -1) {
                            const jpegData = frameSection.slice(headerEnd + CRLFCRLF.length);

                            // Validate it's actually JPEG (starts with FF D8)
                            if (jpegData.length > 2 && jpegData[0] === 0xFF && jpegData[1] === 0xD8) {
                                const base64 = jpegData.toString('base64');
                                this.socket.emit('stream_preview', {
                                    deviceId: this.deviceId,
                                    image: `data:image/jpeg;base64,${base64}`,
                                });
                                frameCount++;
                                if (frameCount % 100 === 1) {
                                    console.log(`[StreamSession] MJPEG frame #${frameCount} (${(jpegData.length / 1024).toFixed(0)}KB) for ${this.deviceId}`);
                                }
                            }
                        }

                        // Consume processed data
                        buffer = buffer.slice(nextBoundaryIdx);
                    }

                    // Prevent buffer from growing unbounded
                    if (buffer.length > 5 * 1024 * 1024) {
                        buffer = buffer.slice(buffer.length - 1024 * 1024);
                    }
                });

                res.on('end', () => {
                    console.log(`[StreamSession] MJPEG stream ended for ${this.deviceId}`);
                    resolve();
                });

                res.on('error', (err) => {
                    console.error(`[StreamSession] MJPEG stream error:`, err.message);
                    resolve();
                });
            });

            req.on('error', (err) => {
                console.error(`[StreamSession] MJPEG connection error:`, err.message);
                resolve();
            });

            // Store a reference so we can abort on stop
            (this as any)._mjpegRequest = req;
        });
    }

    private async runProcess(size: string) {
        console.log(`[StreamSession] Spawning screen streamer for ${this.deviceId} (${this.platform})...`);

        if (this.platform === 'ios') {
            // iOS: connect to WDA's built-in MJPEG server for real-time streaming
            await this.runIosMjpegStream();
            return;
        }

        // Android: H264 screen recording via adb
        this.process = execa('adb', [
            '-s', this.deviceId,
            'shell', 'screenrecord',
            '--output-format=h264',
            '--bit-rate', '1000000',
            '--size', size,
            '--time-limit', '45',
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
                console.error(`[StreamSession] streamer stderr: ${data.toString()}`);
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
        
        if (this.platform === 'ios') {
            // iOS: take a single screenshot for preview
            try {
                const binary = await this.findIosBinary();
                const tmpFile = path.join('/tmp', `ios_preview_${this.deviceId}.png`);
                await execa(binary, [
                    'screenshot',
                    '--output=' + tmpFile,
                    '--udid=' + this.deviceId,
                ], { env: { ...process.env, ENABLE_GO_IOS_AGENT: 'user' }, timeout: 10000 });
                const imgBuffer = fs.readFileSync(tmpFile);
                const base64 = imgBuffer.toString('base64');
                this.socket.emit('stream_preview', {
                    deviceId: this.deviceId,
                    image: `data:image/png;base64,${base64}`,
                });
                try { fs.unlinkSync(tmpFile); } catch (_) { }
            } catch (e: any) {
                console.warn(`[StreamSession] iOS preview failed:`, e.message);
            }
            return;
        }

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

    constructor(agentId: string, socket: Socket, private deviceManagers: Map<string, IDeviceManager>) {
        this.agentId = agentId;
        this.socket = socket;
    }

    async start(deviceId: string, platform: 'android' | 'ios') {
        if (this.sessions.has(deviceId)) {
            console.log(`[Streamer] Session already exists for ${deviceId}, restarting...`);
            await this.stop(deviceId);
        }

        const manager = this.deviceManagers.get(deviceId);
        if (!manager) {
            console.error(`[Streamer] No device manager found for ${deviceId}`);
            return;
        }

        const session = new StreamSession(deviceId, this.agentId, this.socket, platform, manager);
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
