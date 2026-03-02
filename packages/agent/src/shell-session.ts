import execa from 'execa';

export class ShellSession {
    private process: execa.ExecaChildProcess | null = null;
    private deviceId: string;

    // Callback to emit data back to server
    public onOutput?: (data: string) => void;
    public onReady?: () => void;
    public onExit?: (code: number | null) => void;

    constructor(deviceId: string) {
        this.deviceId = deviceId;
    }

    start() {
        if (this.process) return;

        console.log(`[Shell] Starting interactive shell for ${this.deviceId}`);
        this.process = execa('adb', ['-s', this.deviceId, 'shell', '-tt'], {
            env: { ...process.env, TERM: 'xterm-256color' },
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe'
        });

        // Immediate poke
        if (this.process.stdin) {
            this.process.stdin.write('\n');
        }
        this.onReady?.();

        let outputReceived = false;
        const pokeTimer = setTimeout(() => {
            if (!outputReceived && this.process?.stdin) {
                console.log(`[Shell] No initial output for ${this.deviceId}, poking with Enter...`);
                this.process.stdin.write('\n');
            }
        }, 500);

        let buffer = '';
        let flushTimer: NodeJS.Timeout | null = null;

        const handleData = (data: string) => {
            outputReceived = true;
            clearTimeout(pokeTimer);
            buffer += data;

            if (!flushTimer) {
                flushTimer = setTimeout(() => {
                    if (buffer) {
                        this.onOutput?.(buffer);
                        buffer = '';
                    }
                    flushTimer = null;
                }, 50);
            }
        };

        this.process.stdout?.on('data', (data) => handleData(data.toString()));
        this.process.stderr?.on('data', (data) => handleData(data.toString()));

        this.process.on('exit', (code) => {
            clearTimeout(pokeTimer);
            if (flushTimer) clearTimeout(flushTimer);
            if (buffer) this.onOutput?.(buffer);

            console.log(`[Shell] Process exited with code ${code}`);
            this.onExit?.(code);
            this.process = null;
        });

        this.process.on('error', (err) => {
            clearTimeout(pokeTimer);
            console.error(`[Shell] Process error for ${this.deviceId}:`, err);
        });
    }

    write(data: string) {
        if (this.process?.stdin) {
            this.process.stdin.write(data);
        }
    }

    poke() {
        console.log(`[Shell] Poking session for ${this.deviceId}`);
        this.write('\n');
    }

    async stop() {
        if (this.process) {
            this.process.kill();
            try {
                await this.process;
            } catch (e) {
                // Ignore exit errors
            }
            this.process = null;
        }
    }
}
