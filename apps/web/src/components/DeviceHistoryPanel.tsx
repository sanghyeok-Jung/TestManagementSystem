import React, { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Terminal, Clock, PlayCircle, CheckCircle2, XCircle, Loader2, ListVideo } from 'lucide-react';
import { cn } from "@/lib/utils";
import { TestJob, LogEntry } from '@qa/types';
import axios from 'axios';

interface DeviceHistoryPanelProps {
    socket: any;
    deviceId: string | null;
    agentIdOverride?: string;
}

export const DeviceHistoryPanel: React.FC<DeviceHistoryPanelProps> = ({ socket, deviceId, agentIdOverride }) => {
    const [jobs, setJobs] = useState<TestJob[]>([]);
    const [selectedJob, setSelectedJob] = useState<TestJob | null>(null);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [isLoadingLogs, setIsLoadingLogs] = useState(false);

    const logsEndRef = useRef<HTMLDivElement>(null);

    // Fetch Jobs
    const fetchJobs = async () => {
        try {
            let url = `/api/devices/${deviceId}/jobs`;
            if (deviceId === null && agentIdOverride) {
                // Fetch jobs specifically for this agent where deviceId is null
                // We will need to create a server route or use query params on jobs API
                url = `/api/jobs?agentId=${agentIdOverride}&deviceId=null`;
            }

            const res = await axios.get<TestJob[]>(url);
            const jobsData = res.data;
            setJobs(jobsData);
            // Auto-select latest if none selected
            if (!selectedJob && jobsData.length > 0) {
                setSelectedJob(jobsData[0]);
            } else if (selectedJob) {
                // Update selected job status if it changed
                const updated = jobsData.find((j: TestJob) => j.id === selectedJob.id);
                if (updated) setSelectedJob(updated);
            }
        } catch (error) {
            console.error('Failed to fetch jobs:', error);
        }
    };

    useEffect(() => {
        fetchJobs();

        const onJobUpdated = (job: TestJob) => {
            if (deviceId === null && agentIdOverride) {
                if (job.targetAgentId === agentIdOverride && !job.targetDeviceId) fetchJobs();
            } else if (job.targetDeviceId === deviceId) {
                fetchJobs();
            }
        };

        const onJobCreated = (job: TestJob) => {
            if (deviceId === null && agentIdOverride) {
                if (job.targetAgentId === agentIdOverride && !job.targetDeviceId) {
                    fetchJobs();
                    setSelectedJob(job);
                }
            } else if (job.targetDeviceId === deviceId) {
                fetchJobs();
                // Auto-switch to new job
                setSelectedJob(job);
            }
        }

        socket.on('job_updated', onJobUpdated);
        // We can listen to job_created if the server emits it, or just rely on status updates and polling/refresh
        socket.on('job_created', onJobCreated);

        return () => {
            socket.off('job_updated', onJobUpdated);
            socket.off('job_created', onJobCreated);
        };
    }, [deviceId, agentIdOverride, socket]);

    // Fetch Logs when selected job changes
    useEffect(() => {
        if (!selectedJob) {
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
    }, [selectedJob?.id]);

    // Real-time log streaming for the selected job
    useEffect(() => {
        if (!selectedJob || selectedJob.status !== 'running') return;

        const handleLog = (data: LogEntry) => {
            if (data.jobId === selectedJob.id) {
                setLogs(prev => [...prev, data]);
            }
        };

        socket.on('job_log', handleLog);
        return () => {
            socket.off('job_log', handleLog);
        };
    }, [selectedJob, socket]);

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
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 h-[600px] bg-slate-50/50 p-2 rounded-xl">
            {/* Left: Job List */}
            <Card className="md:col-span-4 flex flex-col overflow-hidden shadow-sm border-slate-200">
                <CardHeader className="py-4 px-4 border-b bg-white">
                    <CardTitle className="text-sm font-bold flex items-center gap-2">
                        <ListVideo size={16} className="text-indigo-500" />
                        Execution History
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 p-0 overflow-hidden bg-slate-50">
                    <ScrollArea className="h-full">
                        {jobs.length === 0 ? (
                            <div className="p-8 text-center text-slate-500">
                                <p className="text-sm font-medium">No jobs found for this target.</p>
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
                                            <span className="text-[11px] text-slate-500 font-mono bg-slate-100 px-1.5 py-0.5 rounded truncate max-w-[120px]">
                                                {job.command}
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
                    <CardTitle className="text-[11px] font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                        <Terminal size={14} className="text-indigo-400" />
                        {selectedJob ? `Logs: ${selectedJob.scriptId}` : 'Select a job to view logs'}
                    </CardTitle>
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
    );
};
