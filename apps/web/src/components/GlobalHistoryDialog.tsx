import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { TestJob, LogEntry } from '@qa/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle as UiCardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Terminal, CheckCircle2, PlayCircle, ListVideo, XCircle, Clock } from 'lucide-react';
import { cn } from "@/lib/utils";

interface GlobalHistoryDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

// Create a persistent socket simply for the dialog if it doesn't receive one from props
const socket = io({ transports: ['websocket'] });

export const GlobalHistoryDialog: React.FC<GlobalHistoryDialogProps> = ({ isOpen, onClose }) => {
    const [jobs, setJobs] = useState<TestJob[]>([]);
    const [selectedJob, setSelectedJob] = useState<TestJob | null>(null);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [isLoadingLogs, setIsLoadingLogs] = useState(false);

    // We only fetch jobs initially or when dialog opens
    const [isLoading, setIsLoading] = useState(false);
    const logsEndRef = useRef<HTMLDivElement>(null);

    const fetchJobs = async () => {
        setIsLoading(true);
        try {
            const response = await axios.get<TestJob[]>('/api/jobs');
            const data = response.data;
            setJobs(data);
            if (!selectedJob && data.length > 0) {
                setSelectedJob(data[0]);
            } else if (selectedJob) {
                const updated = data.find(j => j.id === selectedJob.id);
                if (updated) setSelectedJob(updated);
            }
        } catch (error) {
            console.error('Failed to fetch global jobs:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchJobs();
        }
    }, [isOpen]);

    // Handle Socket updates for real-time status changes using the shared job events
    useEffect(() => {
        if (!isOpen) return;

        const onJobUpdated = (_job: TestJob) => {
            fetchJobs(); // Refetch to keep global list synced
        };
        const onJobCreated = (job: TestJob) => {
            fetchJobs();
            setSelectedJob(job);
        };

        socket.on('job_updated', onJobUpdated);
        socket.on('job_created', onJobCreated);

        return () => {
            socket.off('job_updated', onJobUpdated);
            socket.off('job_created', onJobCreated);
        };
    }, [isOpen]);

    // Fetch Logs when selected job changes
    useEffect(() => {
        if (!selectedJob || !isOpen) {
            setLogs([]);
            return;
        }

        const fetchLogs = async () => {
            setIsLoadingLogs(true);
            try {
                const res = await axios.get<{ logs: LogEntry[] }>(`/api/jobs/${selectedJob.id}/logs`);
                setLogs(res.data.logs || []);
            } catch (error) {
                console.error('Failed to fetch logs:', error);
                setLogs([]);
            } finally {
                setIsLoadingLogs(false);
            }
        };

        fetchLogs();
    }, [selectedJob?.id, isOpen]);

    // Real-time log streaming for the selected job
    useEffect(() => {
        if (!selectedJob || selectedJob.status !== 'running' || !isOpen) return;

        const handleLog = (data: LogEntry) => {
            if (data.jobId === selectedJob.id) {
                setLogs(prev => [...prev, data]);
            }
        };

        socket.on('job_log', handleLog);
        return () => {
            socket.off('job_log', handleLog);
        };
    }, [selectedJob, isOpen]);

    // Auto-scroll
    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [logs]);

    const formatDuration = (start: number, end?: number) => {
        if (!end) return 'Running...';
        const ms = end - start;
        const s = Math.floor(ms / 1000);
        if (s < 60) return `${s}s`;
        const m = Math.floor(s / 60);
        return `${m}m ${s % 60}s`;
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'running': return <Loader2 size={14} className="animate-spin text-blue-500" />;
            case 'completed': return <CheckCircle2 size={14} className="text-emerald-500" />;
            case 'failed': return <XCircle size={14} className="text-rose-500" />;
            default: return <PlayCircle size={14} className="text-slate-400" />;
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[70vw] h-[85vh] flex flex-col p-0 overflow-hidden bg-slate-50 border-slate-200">
                <DialogHeader className="px-6 py-4 border-b border-slate-200 bg-white shadow-sm z-10 flex flex-row items-center justify-between">
                    <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-800">
                        <Terminal size={20} className="text-indigo-500" />
                        Global Automation History
                    </DialogTitle>
                    <DialogClose className="rounded-full p-1.5 hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400">
                        <XCircle size={20} strokeWidth={2} />
                    </DialogClose>
                </DialogHeader>

                <div className="flex-1 overflow-hidden p-6 relative">
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 h-full bg-slate-50/50 rounded-xl">
                        {/* Left: Job List */}
                        <Card className="md:col-span-4 flex flex-col overflow-hidden shadow-sm border-slate-200">
                            <CardHeader className="py-4 px-4 border-b bg-white">
                                <UiCardTitle className="text-sm font-bold flex items-center gap-2">
                                    <ListVideo size={16} className="text-indigo-500" />
                                    Execution History
                                </UiCardTitle>
                            </CardHeader>
                            <CardContent className="flex-1 p-0 overflow-hidden bg-slate-50">
                                <ScrollArea className="h-full">
                                    {isLoading ? (
                                        <div className="flex items-center justify-center p-8 text-slate-400">
                                            <Loader2 size={24} className="animate-spin" />
                                        </div>
                                    ) : jobs.length === 0 ? (
                                        <div className="p-8 text-center text-slate-500">
                                            <p className="text-sm font-medium">No global history found.</p>
                                        </div>
                                    ) : (
                                        <div className="p-2 space-y-1">
                                            {jobs.map(job => (
                                                <button
                                                    key={job.id}
                                                    onClick={() => setSelectedJob(job)}
                                                    className={cn(
                                                        "w-full text-left p-3 rounded-lg transition-all border flex flex-col gap-2",
                                                        selectedJob?.id === job.id
                                                            ? "bg-white border-indigo-200 shadow-sm ring-1 ring-indigo-500/10"
                                                            : "bg-transparent border-transparent hover:bg-white hover:border-slate-200"
                                                    )}
                                                >
                                                    <div className="flex justify-between items-start gap-2">
                                                        <div className="flex items-center gap-1.5 font-bold text-[13px] text-slate-900 truncate">
                                                            {getStatusIcon(job.status)}
                                                            <span className="truncate">{job.scriptId.replace('proj-', '')}</span>
                                                        </div>
                                                        <span className="text-[10px] text-slate-400 font-medium whitespace-nowrap">
                                                            {new Date(job.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[11px] text-slate-500 font-mono bg-slate-100 px-1.5 py-0.5 rounded truncate max-w-[80px]">
                                                            {job.targetDeviceId}
                                                        </span>
                                                        <span className="text-[10px] font-medium text-slate-400">
                                                            {formatDuration(job.createdAt, job.completedAt)}
                                                        </span>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </ScrollArea>
                            </CardContent>
                        </Card>

                        {/* Right: Log Viewer */}
                        <Card className="md:col-span-8 flex flex-col overflow-hidden shadow-xl border-slate-800 bg-slate-950">
                            <CardHeader className="py-3 px-4 bg-slate-900 border-b border-slate-800 flex flex-row items-center justify-between space-y-0">
                                <UiCardTitle className="text-[11px] font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                                    <Terminal size={14} className="text-indigo-400" />
                                    {selectedJob ? `Logs: [${selectedJob.targetDeviceId || 'Agent VM'}] ${selectedJob.scriptId}` : 'Select a job to view logs'}
                                </UiCardTitle>
                                {selectedJob && (
                                    <Badge
                                        variant="outline"
                                        className={cn(
                                            "text-[10px] font-bold uppercase",
                                            selectedJob.status === 'running' ? "border-blue-500/30 text-blue-400 bg-blue-500/10" :
                                                selectedJob.status === 'completed' ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" :
                                                    "border-rose-500/30 text-rose-400 bg-rose-500/10"
                                        )}>
                                        {selectedJob.status}
                                    </Badge>
                                )}
                            </CardHeader>
                            <CardContent className="p-0 flex-1 overflow-hidden relative">
                                {isLoadingLogs && (
                                    <div className="absolute inset-0 z-10 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center">
                                        <Loader2 className="animate-spin text-indigo-500" size={24} />
                                    </div>
                                )}

                                <ScrollArea className="h-full w-full">
                                    <div className="p-4 font-mono text-[11px] leading-relaxed">
                                        {!selectedJob ? (
                                            <div className="h-full flex flex-col items-center justify-center py-32 text-slate-700 opacity-50">
                                                <Terminal size={32} className="mb-4" />
                                                <p className="font-bold tracking-tight text-sm">NO JOB SELECTED</p>
                                            </div>
                                        ) : logs.length === 0 && !isLoadingLogs ? (
                                            <div className="h-full flex flex-col items-center justify-center py-20 text-slate-700 opacity-50">
                                                <p className="font-bold tracking-tight">NO LOGS AVAILABLE</p>
                                            </div>
                                        ) : (
                                            logs.map((log, i) => (
                                                <div
                                                    key={i}
                                                    className={cn(
                                                        "group flex gap-3 mb-1.5 py-0.5 px-1 rounded transition-colors",
                                                        log.type === 'stderr' ? 'text-rose-400 hover:bg-rose-500/5' :
                                                            log.type === 'system' ? 'text-sky-400 hover:bg-sky-500/5' :
                                                                'text-slate-300 hover:bg-slate-800'
                                                    )}
                                                >
                                                    <span className="flex items-center gap-1 opacity-40 shrink-0 select-none text-[9px] font-bold mt-0.5">
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
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
