import React, { useState } from 'react';
import { Socket } from 'socket.io-client';
import { Agent } from '@qa/types';
import { ShellTerminal } from './ShellTerminal';
import { DeviceHistoryPanel } from './DeviceHistoryPanel';
import { cn } from "@/lib/utils";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Server, RotateCcw, TerminalSquare } from 'lucide-react';

interface NodeFarmPanelProps {
    socket: Socket;
    agent: Agent;
    initialTab?: 'control' | 'history';
    onClose: () => void;
}

export const NodeFarmPanel: React.FC<NodeFarmPanelProps> = ({ socket, agent, initialTab = 'control', onClose }) => {
    const [activeTab, setActiveTab] = useState<'control' | 'history'>(initialTab);
    const agentId = agent.id;

    return (
        <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-[95vw] w-[1400px] h-[90vh] p-0 gap-0 overflow-hidden bg-slate-50/50 backdrop-blur-xl border-slate-200/50 shadow-2xl ring-1 ring-black/5 flex flex-col focus-visible:outline-none">

                <DialogHeader className="px-6 py-4 bg-white/80 backdrop-blur-md border-b border-slate-200/50 flex-none flex flex-row items-center justify-between">
                    <div className="space-y-1">
                        <DialogTitle className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-4">
                            Node Control Panel (Browser / API)
                            <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                                <button
                                    onClick={() => setActiveTab('control')}
                                    className={cn(
                                        "px-3 py-1 text-[11px] font-bold uppercase tracking-wider rounded-md transition-all flex items-center gap-2",
                                        activeTab === 'control' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                                    )}
                                >
                                    <TerminalSquare size={14} />
                                    Terminal
                                </button>
                                <button
                                    onClick={() => setActiveTab('history')}
                                    className={cn(
                                        "px-3 py-1 text-[11px] font-bold uppercase tracking-wider rounded-md transition-all flex items-center gap-2",
                                        activeTab === 'history' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                                    )}
                                >
                                    <RotateCcw size={14} />
                                    Job History
                                </button>
                            </div>
                        </DialogTitle>
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono text-[10px] bg-slate-100/50 border-slate-200 text-slate-600">
                                {agentId}
                            </Badge>
                            <span className="text-slate-300">/</span>
                            <Badge variant="secondary" className="font-mono text-[10px] bg-blue-50 text-blue-600 border-blue-100">
                                {agent.hostname} ({agent.ip})
                            </Badge>
                        </div>
                    </div>
                </DialogHeader>

                {activeTab === 'history' ? (
                    <div className="flex-1 p-4 bg-slate-50/30 overflow-hidden min-h-0">
                        {/* DeviceHistoryPanel expects deviceId as a string. We cast null as unknown as string to fetch jobs with deviceId = null for this agent */}
                        <DeviceHistoryPanel socket={socket} deviceId={null as unknown as string} agentIdOverride={agent.id} />
                    </div>
                ) : (
                    <div className="flex-1 p-4 bg-slate-50/30 min-h-0 overflow-hidden flex">
                        <Card className="flex-1 min-h-0 flex flex-col overflow-hidden border-slate-200/60 shadow-sm bg-slate-900 ring-1 ring-white/5">
                            <div className="p-3 border-b border-white/5 flex items-center justify-between">
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                                    <Server size={14} />
                                    Node Shell
                                </h3>
                            </div>
                            <div className="flex-1 min-h-0 p-1">
                                {/* Using deviceId = 'node-shell' to signal to the agent to use local shell instead of ADB. This might require minor backend change later, let's keep it null for now to match API tasks if possible but agent needs to know */}
                                <ShellTerminal socket={socket} agentId={agentId} deviceId={'NODE_SHELL'} readonly={false} />
                            </div>
                        </Card>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
