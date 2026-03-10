import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { Socket } from 'socket.io-client';
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Power, Terminal as TerminalIcon } from 'lucide-react';

import 'xterm/css/xterm.css';

interface ShellTerminalProps {
    socket: Socket;
    agentId: string;
    deviceId: string;
    readonly?: boolean;
}

export const ShellTerminal: React.FC<ShellTerminalProps> = ({ socket, agentId, deviceId, readonly = false }) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const [isConnected, setIsConnected] = React.useState(false);

    // Use a ref for readonly to access it in the listener without re-running the effect
    const readonlyRef = useRef(readonly);
    useEffect(() => {
        readonlyRef.current = readonly;
    }, [readonly]);

    useEffect(() => {
        if (!terminalRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            fontSize: 12,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            theme: {
                background: '#0f172a', // slate-950
                foreground: '#cbd5e1', // slate-300
                cursor: '#3b82f6', // blue-500
            },
            allowProposedApi: true
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);

        term.open(terminalRef.current);
        term.write('\x1b[34m[System] Initializing interactive session...\x1b[0m\r\n');

        // Minor delay to ensure container is rendered before fitting
        setTimeout(() => fitAddon.fit(), 100);

        // Handle user input
        term.onData((data) => {
            if (!readonlyRef.current) {
                socket.emit('shell_input', { agentId, deviceId, input: data });
            }
        });

        // Handle incoming data
        const handleOutput = (data: { agentId: string, deviceId: string, output: string }) => {
            if (data.agentId === agentId && data.deviceId === deviceId) {
                term.write(data.output);
                setIsConnected(true);
            }
        };

        const handleReady = (data: { agentId: string, deviceId: string }) => {
            if (data.agentId === agentId && data.deviceId === deviceId) {
                setIsConnected(true);
            }
        };

        socket.on('shell_output', handleOutput);
        socket.on('shell_ready', handleReady);

        // Generate a unique session ID for this mount to handle race conditions
        const sessionId = Math.random().toString(36).substring(7);

        // Start shell session AFTER listener is ready
        socket.emit('shell_start', { agentId, deviceId, sessionId });

        // Handle resize
        const handleResize = () => fitAddon.fit();
        window.addEventListener('resize', handleResize);

        return () => {
            console.log(`[Terminal] Unmounting terminal for ${deviceId}, sessionId: ${sessionId}`);
            socket.off('shell_output', handleOutput);
            socket.off('shell_ready', handleReady);
            socket.emit('shell_stop', { agentId, deviceId, sessionId });
            term.dispose();
            window.removeEventListener('resize', handleResize);
        };
    }, [socket, agentId, deviceId]);

    return (
        <div className="flex flex-col h-full bg-slate-950 overflow-hidden relative group">
            <div className="flex-1 min-h-0" ref={terminalRef} />

            {readonly && (
                <div className="absolute inset-0 z-10 bg-black/10 pointer-events-none flex items-center justify-center">
                    <Badge variant="destructive" className="opacity-50">VIEW ONLY</Badge>
                </div>
            )}

            <div className="absolute top-2 right-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Badge
                    variant={isConnected ? "secondary" : "outline"}
                    className={cn(
                        "gap-1 px-2 py-0.5 text-[9px] font-bold border-white/10",
                        isConnected ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-800 text-slate-500"
                    )}
                >
                    <Power size={10} className={isConnected ? "animate-pulse" : ""} />
                    {isConnected ? "SESSION ACTIVE" : "INITIALIZING"}
                </Badge>
            </div>

            <div className="absolute bottom-2 right-4 flex items-center gap-2 text-[9px] font-bold text-slate-600 uppercase tracking-tighter pointer-events-none">
                <TerminalIcon size={12} />
                Interactive Session
            </div>
        </div>
    );
};
