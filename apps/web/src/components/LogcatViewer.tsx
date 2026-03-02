import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Socket } from 'socket.io-client';
import { ScrollArea } from "./ui/scroll-area";
import { Input } from "./ui/input";
import { Search, Hash, Tag as TagIcon, Activity } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface LogcatViewerProps {
    socket: Socket;
    agentId: string;
    deviceId: string;
    readonly?: boolean;
}

export interface LogEntry {
    id: string;
    timestamp: string;
    pid: string;
    tid: string;
    level: string;
    tag: string;
    message: string;
    raw: string;
}

export interface LogcatViewerHandle {
    isRunning: boolean;
    autoScroll: boolean;
    toggleRun: () => void;
    toggleAutoScroll: () => void;
    clearLogs: () => void;
}

const parseLogLine = (line: string): LogEntry => {
    // threadtime format: 02-15 17:23:09.123  1234  5678 V Tag: Message
    const regex = /^(\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEAF])\s+([^:]+):\s+(.*)$/;
    const match = line.match(regex);

    if (match) {
        return {
            id: Math.random().toString(36).substr(2, 9),
            timestamp: match[1],
            pid: match[2],
            tid: match[3],
            level: match[4],
            tag: match[5].trim(),
            message: match[6],
            raw: line
        };
    }

    return {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: '',
        pid: '',
        tid: '',
        level: '',
        tag: '',
        message: line,
        raw: line
    };
};

const getLevelColor = (level: string) => {
    switch (level) {
        case 'V': return 'text-slate-400';
        case 'D': return 'text-sky-400';
        case 'I': return 'text-emerald-400';
        case 'W': return 'text-amber-400';
        case 'E': return 'text-rose-400';
        case 'A': return 'text-purple-400';
        case 'F': return 'text-rose-600 font-bold';
        default: return 'text-emerald-400/90';
    }
};

const LogLine = React.memo(({ log }: { log: LogEntry }) => {
    return (
        <div
            className={cn(
                "flex gap-3 px-1 py-0.5 rounded transition-colors group hover:bg-white/5",
                getLevelColor(log.level)
            )}
            style={{ contentVisibility: 'auto', containIntrinsicSize: '18px' }}
        >
            <span className="shrink-0 text-slate-600 text-[9px] w-28 select-none font-bold">
                {log.timestamp || 'RAW'}
            </span>
            {log.tag && (
                <>
                    <span className="shrink-0 text-slate-500/80 w-8 select-none text-[9px]">
                        {log.pid}
                    </span>
                    <span className="shrink-0 text-slate-500/80 w-8 select-none text-[9px]">
                        {log.tid}
                    </span>
                    <span className="shrink-0 font-bold w-16 truncate select-none">
                        {log.tag}
                    </span>
                </>
            )}
            <span className="whitespace-pre-wrap break-all flex-1 opacity-90 group-hover:opacity-100">
                {log.message}
            </span>
        </div>
    );
});

export const LogcatViewer = React.forwardRef<LogcatViewerHandle, LogcatViewerProps>(
    ({ socket, agentId, deviceId, readonly = false }, ref) => {
        const [logs, setLogs] = useState<LogEntry[]>([]);
        const [isRunning, setIsRunning] = useState(false);
        const [autoScroll, setAutoScroll] = useState(true);
        const logsEndRef = useRef<HTMLDivElement>(null);

        // Filter states
        const [filterTag, setFilterTag] = useState('');
        const [filterPid, setFilterPid] = useState('');
        const [filterTid, setFilterTid] = useState('');
        const [searchTerm, setSearchTerm] = useState('');

        React.useImperativeHandle(ref, () => ({
            isRunning,
            autoScroll,
            toggleRun,
            toggleAutoScroll: () => setAutoScroll(prev => !prev),
            clearLogs
        }));

        const logBufferRef = useRef<LogEntry[]>([]);

        useEffect(() => {
            let updateTimer: NodeJS.Timeout | null = null;

            const flushBuffer = () => {
                if (logBufferRef.current.length > 0) {
                    const newEntries = [...logBufferRef.current];
                    logBufferRef.current = [];
                    // Keep only last 1000 logs to prevent DOM overload
                    setLogs(prev => {
                        const next = [...prev, ...newEntries];
                        return next.length > 1000 ? next.slice(-1000) : next;
                    });
                }
                updateTimer = null;
            };

            const handleLog = (data: { agentId: string, deviceId: string, log: string }) => {
                if (data.agentId === agentId && data.deviceId === deviceId) {
                    const lines = data.log.split('\n').filter(l => l.trim());
                    const parsedEntries = lines.map(line => parseLogLine(line));

                    logBufferRef.current.push(...parsedEntries);

                    if (!updateTimer) {
                        updateTimer = setTimeout(flushBuffer, 100);
                    }
                }
            };

            socket.on('logcat_data', handleLog);

            return () => {
                socket.off('logcat_data', handleLog);
                if (updateTimer) clearTimeout(updateTimer);
                if (isRunning) {
                    socket.emit('logcat_stop', { agentId, deviceId });
                }
            };
        }, [socket, agentId, deviceId, isRunning]);

        useEffect(() => {
            if (isRunning && autoScroll && logsEndRef.current) {
                logsEndRef.current.scrollIntoView({ behavior: "auto", block: "end" });
            }
        }, [logs, isRunning, autoScroll]);

        const toggleRun = () => {
            if (readonly) return; // Block control if readonly
            if (isRunning) {
                socket.emit('logcat_stop', { agentId, deviceId });
                setIsRunning(false);
            } else {
                socket.emit('logcat_start', { agentId, deviceId });
                setIsRunning(true);
            }
        };

        const clearLogs = () => {
            // Local clear is fine, but if it emits "logcat_clear" it affects global.
            // Our implementation emits: socket.emit('logcat_clear', ...);
            // So we must block it if readonly.
            if (readonly) return;
            setLogs([]);
            socket.emit('logcat_clear', { agentId, deviceId });
        };

        const filteredLogs = useMemo(() => {
            return logs.filter(log => {
                const matchesTag = !filterTag || log.tag.toLowerCase().includes(filterTag.toLowerCase());
                const matchesPid = !filterPid || log.pid.includes(filterPid);
                const matchesTid = !filterTid || log.tid.includes(filterTid);
                const matchesSearch = !searchTerm || log.raw.toLowerCase().includes(searchTerm.toLowerCase());
                return matchesTag && matchesPid && matchesTid && matchesSearch;
            });
        }, [logs, filterTag, filterPid, filterTid, searchTerm]);

        return (
            <div className="flex flex-col h-full min-h-0 bg-slate-950 overflow-hidden relative">
                {readonly && (
                    <div className="absolute inset-0 z-20 bg-transparent pointer-events-none flex items-center justify-center">
                        {/* We don't necessarily block selecting text, so maybe just a badge in the corner? 
                            Or disable the buttons specifically. 
                            Let's just put a badge. */}
                        <div className="absolute top-2 right-2">
                            <Badge variant="destructive" className="opacity-50 text-[10px]">VIEW ONLY</Badge>
                        </div>
                    </div>
                )}
                {/* Filter Bar */}
                <div className="flex-none p-2 bg-slate-900 border-b border-slate-800 grid grid-cols-4 gap-2">
                    <div className="relative group">
                        <TagIcon className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 w-3.5 h-3.5 group-focus-within:text-blue-400 transition-colors" />
                        <Input
                            placeholder="Filter Tag..."
                            value={filterTag}
                            onChange={(e) => setFilterTag(e.target.value)}
                            className="h-8 pl-7 text-[10px] bg-slate-950 border-slate-800 text-slate-300 placeholder:text-slate-600 focus-visible:ring-blue-500/50"
                        />
                    </div>
                    <div className="relative group">
                        <Hash className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 w-3.5 h-3.5 group-focus-within:text-blue-400 transition-colors" />
                        <Input
                            placeholder="PID"
                            value={filterPid}
                            onChange={(e) => setFilterPid(e.target.value)}
                            className="h-8 pl-7 text-[10px] bg-slate-950 border-slate-800 text-slate-300 placeholder:text-slate-600 focus-visible:ring-blue-500/50"
                        />
                    </div>
                    <div className="relative group">
                        <Activity className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 w-3.5 h-3.5 group-focus-within:text-blue-400 transition-colors" />
                        <Input
                            placeholder="TID"
                            value={filterTid}
                            onChange={(e) => setFilterTid(e.target.value)}
                            className="h-8 pl-7 text-[10px] bg-slate-950 border-slate-800 text-slate-300 placeholder:text-slate-600 focus-visible:ring-blue-500/50"
                        />
                    </div>
                    <div className="relative group">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 w-3.5 h-3.5 group-focus-within:text-blue-400 transition-colors" />
                        <Input
                            placeholder="Search logs..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="h-8 pl-7 text-[10px] bg-slate-950 border-slate-800 text-slate-300 placeholder:text-slate-600 focus-visible:ring-blue-500/50"
                        />
                    </div>
                </div>

                {/* Log List */}
                <ScrollArea className="flex-1 w-full">
                    <div className="p-3 font-mono text-[11px] leading-relaxed">
                        {filteredLogs.length === 0 && logs.length > 0 && (
                            <div className="py-20 text-center text-slate-600 italic">
                                No logs matching current filters
                            </div>
                        )}
                        {filteredLogs.map((log) => (
                            <LogLine key={log.id} log={log} />
                        ))}
                        <div ref={logsEndRef} className="h-4" />
                    </div>
                </ScrollArea>

                {/* Stats Footer */}
                <div className="flex-none px-3 py-1 bg-slate-900/50 border-t border-slate-800 flex justify-between items-center text-[9px] font-bold text-slate-500 uppercase tracking-tight">
                    <div className="flex gap-4">
                        <span>Total: {logs.length}</span>
                        <span className={filteredLogs.length !== logs.length ? "text-blue-400" : ""}>
                            Filtered: {filteredLogs.length}
                        </span>
                    </div>
                    {isRunning && (
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            RECEIVING DATA
                        </div>
                    )}
                </div>
            </div>
        );
    }
);
