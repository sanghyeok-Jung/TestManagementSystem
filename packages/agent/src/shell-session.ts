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

        const isWin = process.platform === 'win32';
        const eol = isWin ? '\r\n' : '\n';
        let shell = '';
        let args: string[] = [];

        if (this.deviceId === 'NODE_SHELL') {
            const userShell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
            const isWin = process.platform === 'win32';

            if (!isWin) {
                // The "Holy Grail" trick for non-node-pty environments:
                // Use python3's pty module to provide a real TTY to the shell.
                shell = 'python3';
                args = ['-c', `import pty, os; pty.spawn([os.environ.get('SHELL', '${userShell}'), '-i'])`];
            } else {
                shell = 'cmd.exe';
                args = [];
            }

            console.log(`[Shell] Spawning local shell with PTY simulation: ${shell} ${args.join(' ')}`);

            this.process = execa(shell, args, {
                env: {
                    ...process.env,
                    TERM: 'xterm-256color',
                    PAGER: 'cat',
                    FORCE_COLOR: 'true',
                    LANG: process.env.LANG || 'en_US.UTF-8'
                },
                stdin: 'pipe',
                stdout: 'pipe',
                stderr: 'pipe',
                shell: false
            });
        } else {
            shell = 'adb';
            args = ['-s', this.deviceId, 'shell', '-tt'];
            this.process = execa(shell, args, {
                env: { ...process.env, TERM: 'xterm-256color' },
                stdin: 'pipe',
                stdout: 'pipe',
                stderr: 'pipe'
            });
        }

        // Emit a startup message
        const startupMsg = `\r\n\x1b[36m[Agent] Spawning local shell: ${shell} ${args.join(' ')}\x1b[0m\r\n` +
            `\x1b[32m[Agent] Using basic /bin/sh (Simple Pipe mode)\x1b[0m\r\n`;
        this.onOutput?.(startupMsg);

        // Immediate poke to trigger prompt
        if (this.process.stdin) {
            console.log(`[Shell] Sending initial poke (EOL) to ${this.deviceId}`);
            this.process.stdin.write(eol);
        }

        // Signal ready to listener
        this.onReady?.();

        let outputReceived = false;
        const pokeTimer = setTimeout(() => {
            if (!outputReceived && this.process?.stdin) {
                console.log(`[Shell] No initial output for ${this.deviceId}, poking with Enter...`);
                // No extra output here to keep terminal clean
                this.process.stdin.write(eol);
            }
        }, 3000);

        const handleData = (data: string) => {
            outputReceived = true;
            clearTimeout(pokeTimer);

            if (this.deviceId === 'NODE_SHELL') {
                const isPythonPty = !isWin && shell === 'python3';
                if (!isPythonPty) {
                    // Pipe-mode: fix staircase effect
                    const normalized = data.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
                    this.onOutput?.(normalized);
                } else {
                    // PTY-mode: let PTY handle it
                    this.onOutput?.(data);
                }
            } else {
                this.onOutput?.(data);
            }
        };

        this.process.stdout?.on('data', (data) => handleData(data.toString()));
        this.process.stderr?.on('data', (data) => handleData(data.toString()));

        this.process.on('exit', (code, signal) => {
            clearTimeout(pokeTimer);

            console.log(`[Shell] Process exited with code ${code}, signal ${signal}`);
            this.onExit?.(code);
            this.onOutput?.(`\r\n\x1b[31m[Agent] Shell process exited (code: ${code}, signal: ${signal})\x1b[0m\r\n`);
            this.process = null;
        });

        this.process.on('error', (err) => {
            clearTimeout(pokeTimer);
            console.error(`[Shell] Process error for ${this.deviceId}:`, err);
        });
    }

    write(data: string) {
        if (this.process?.stdin) {
            const isWin = process.platform === 'win32';
            // We use the spawnfile to detect if we're in PTY mode
            const isPythonPty = !isWin && this.process.spawnfile.includes('python');

            if (isPythonPty) {
                // PTY handles echoing and complex inputs natively
                this.process.stdin.write(data);
            } else {
                // Pipe-mode: manual echo and EOL normalization
                const formattedData = isWin ? data : data.replace(/\r/g, '\n');
                this.process.stdin.write(formattedData);

                if (this.deviceId === 'NODE_SHELL') {
                    const echoData = data.replace(/\n/g, '\r\n').replace(/\r/g, '\r\n').replace(/\r\r\n/g, '\r\n');
                    this.onOutput?.(echoData);
                }
            }
        }
    }

    poke() {
        console.log(`[Shell] Poking session for ${this.deviceId}`);
        const isWin = process.platform === 'win32';
        const eol = isWin ? '\r\n' : '\n';
        this.write(eol);
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
