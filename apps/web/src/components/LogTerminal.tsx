import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Terminal, Trash2, Clock } from 'lucide-react';
import { cn } from "@/lib/utils";

interface LogEntry {
    jobId: string;
    type: 'stdout' | 'stderr' | 'system';
    message: string;
    timestamp: number;
}

interface LogTerminalProps {
    socket: any;
}

export const LogTerminal: React.FC<LogTerminalProps> = ({ socket }) => {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const logsEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleLog = (data: LogEntry) => {
            setLogs(prev => [...prev.slice(-499), data]); // Keep last 500 logs for performance
        };

        socket.on('job_log', handleLog);

        return () => {
            socket.off('job_log', handleLog);
        };
    }, [socket]);

    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
        }
    }, [logs]);

    return (
        <Card className="border-slate-800 bg-slate-900 shadow-2xl overflow-hidden flex flex-col h-[400px]">
            <CardHeader className="flex flex-row items-center justify-between px-4 py-2 bg-slate-800/50 border-b border-slate-800 space-y-0">
                <CardTitle className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <Terminal size={14} className="text-emerald-500" />
                    Automation Logs
                </CardTitle>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setLogs([])}
                    className="h-6 w-6 text-slate-500 hover:text-rose-400 hover:bg-rose-400/10 rounded-md transition-colors"
                >
                    <Trash2 size={12} />
                </Button>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-hidden bg-slate-950">
                <ScrollArea className="h-full w-full">
                    <div className="p-4 font-mono text-[11px] leading-relaxed">
                        {logs.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center py-20 text-slate-700 opacity-50">
                                <Terminal size={24} className="mb-2" />
                                <p className="font-bold tracking-tight">WAITING FOR JOB OUTPUT...</p>
                            </div>
                        ) : (
                            logs.map((log, i) => (
                                <div
                                    key={i}
                                    className={cn(
                                        "group flex gap-3 mb-1.5 py-0.5 px-1 rounded transition-colors",
                                        log.type === 'stderr' ? 'text-rose-400 hover:bg-rose-500/5' :
                                            log.type === 'system' ? 'text-sky-400 hover:bg-sky-500/5' :
                                                'text-slate-300 hover:bg-emerald-500/5'
                                    )}
                                >
                                    <span className="flex items-center gap-1 opacity-40 shrink-0 select-none text-[9px] font-bold">
                                        <Clock size={10} />
                                        {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                    </span>
                                    <span className="break-all whitespace-pre-wrap">{log.message}</span>
                                </div>
                            ))
                        )}
                        <div ref={logsEndRef} className="h-2" />
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
};
