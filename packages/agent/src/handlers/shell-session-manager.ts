import { Socket } from 'socket.io-client';
import { ShellSession } from '../shell-session';
import { LogcatSession } from '../logcat-session';

export class ShellSessionManager {
    private socket: Socket;
    private agentId: string;
    private shellSessions = new Map<string, ShellSession>();
    private logcatSessions = new Map<string, LogcatSession>();
    private stopTimeouts = new Map<string, NodeJS.Timeout>();

    constructor(socket: Socket, agentId: string) {
        this.socket = socket;
        this.agentId = agentId;
    }

    setupHandlers() {
        // --- SHELL ---
        this.socket.on('shell_start', async (data: { agentId: string, deviceId: string }) => {
            console.log('[Agent] shell_start received:', data);
            const { deviceId } = data;

            const pendingStop = this.stopTimeouts.get(`shell:${deviceId}`);
            if (pendingStop) {
                console.log('[Agent] Cancelling pending shell_stop for', deviceId);
                clearTimeout(pendingStop);
                this.stopTimeouts.delete(`shell:${deviceId}`);
            }

            const existingSession = this.shellSessions.get(deviceId);
            if (existingSession) {
                console.log('[Agent] Shell session already exists for', deviceId, '- Resyncing state');
                this.socket.emit('shell_ready', { agentId: this.agentId, deviceId });
                setTimeout(() => existingSession.poke(), 50);
                return;
            }

            const session = new ShellSession(deviceId);
            session.onOutput = (output) => {
                this.socket.emit('shell_output', { agentId: this.agentId, deviceId, output });
            };
            session.onReady = () => {
                this.socket.emit('shell_ready', { agentId: this.agentId, deviceId });
            };
            session.onExit = (code) => {
                this.socket.emit('shell_output', { agentId: this.agentId, deviceId, output: `\r\n\x1b[31m[System] Process exited with code ${code}\x1b[0m\r\n` });
                this.shellSessions.delete(deviceId);
            };
            session.start();
            this.shellSessions.set(deviceId, session);
        });

        this.socket.on('shell_input', (data: { deviceId: string, input: string }) => {
            const session = this.shellSessions.get(data.deviceId);
            if (session) {
                session.write(data.input);
            }
        });

        this.socket.on('shell_stop', (data: { deviceId: string }) => {
            console.log('[Agent] shell_stop received (delayed):', data);
            const { deviceId } = data;

            const timeout = setTimeout(async () => {
                const session = this.shellSessions.get(deviceId);
                if (session) {
                    console.log('[Agent] Stopping shell session for', deviceId);
                    await session.stop();
                    this.shellSessions.delete(deviceId);
                }
                this.stopTimeouts.delete(`shell:${deviceId}`);
            }, 1000);

            this.stopTimeouts.set(`shell:${deviceId}`, timeout);
        });

        // --- LOGCAT ---
        this.socket.on('logcat_start', (data: { deviceId: string }) => {
            const { deviceId } = data;
            if (this.logcatSessions.has(deviceId)) return;

            const session = new LogcatSession(deviceId);
            session.onLog = (log) => {
                this.socket.emit('logcat_data', { agentId: this.agentId, deviceId, log });
            };
            session.start();
            this.logcatSessions.set(deviceId, session);
        });

        this.socket.on('logcat_stop', async (data: { deviceId: string }) => {
            const session = this.logcatSessions.get(data.deviceId);
            if (session) {
                await session.stop();
                this.logcatSessions.delete(data.deviceId);
            }
        });

        this.socket.on('logcat_clear', async (data: { deviceId: string }) => {
            const session = this.logcatSessions.get(data.deviceId);
            if (session) {
                await session.clear();
            } else {
                const temp = new LogcatSession(data.deviceId);
                await temp.clear();
            }
        });
    }
}
