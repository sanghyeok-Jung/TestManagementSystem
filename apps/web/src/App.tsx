import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { Agent, Project } from '@qa/types';
import { ProjectList } from './components/ProjectList';
import { AgentCard } from './components/AgentCard';
import { DeviceControlPanel } from './components/DeviceControlPanel';
import { ScriptRunnerDialog } from './components/ScriptRunnerDialog';
import { GlobalHistoryDialog } from './components/GlobalHistoryDialog';
import { Activity, Server, LayoutGrid, Package, History } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { Toaster } from 'sonner';

const socket = io({ transports: ['websocket'] });

export default function App() {
    const [isConnected, setIsConnected] = useState(socket.connected);
    const [agents, setAgents] = useState<Agent[]>([]);

    useEffect(() => {
        function onConnect() {
            setIsConnected(true);
        }

        function onDisconnect() {
            setIsConnected(false);
        }

        function onAgentsUpdated(updatedAgents: Agent[]) {
            setAgents(updatedAgents);
        }

        function onProjectsUpdated() {
            setRefreshProjectsTrigger(prev => prev + 1);
        }

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('agents_updated', onAgentsUpdated);
        socket.on('projects_updated', onProjectsUpdated);

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('agents_updated', onAgentsUpdated);
            socket.off('projects_updated', onProjectsUpdated);
        };
    }, []);

    const [selectedDevice, setSelectedDevice] = useState<{ agentId: string, deviceId: string, initialTab?: 'control' | 'history' } | null>(null);
    const [scriptRunnerOpen, setScriptRunnerOpen] = useState(false);
    const [globalHistoryOpen, setGlobalHistoryOpen] = useState(false);
    const [selectedScriptId, setSelectedScriptId] = useState<string>('');

    // Project Management State
    const [refreshProjectsTrigger, setRefreshProjectsTrigger] = useState(0);

    const handleControlDevice = (agentId: string, deviceId: string, tab?: 'control' | 'history') => {
        setSelectedDevice({ agentId, deviceId, initialTab: tab });
    };

    const handleRunProject = (project: Project) => {
        setSelectedScriptId(project.id);
        setScriptRunnerOpen(true);
    };

    return (
        <div className="min-h-screen bg-slate-50/50 text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">
            {/* Navbar */}
            <nav className="bg-white/80 border-b border-slate-200 sticky top-0 z-30 backdrop-blur-md shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16">
                        <div className="flex items-center gap-3">
                            <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-2 rounded-xl text-white shadow-lg shadow-blue-200/50">
                                <Activity size={20} strokeWidth={2.5} />
                            </div>
                            <div className="flex flex-col">
                                <span className="font-bold text-lg tracking-tight leading-none text-slate-900">QA Lab <span className="text-blue-600">Orchestrator</span></span>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Distributed Test System</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setGlobalHistoryOpen(true)}
                                className="h-8 gap-2 px-3 text-slate-600 border-slate-200 hover:bg-slate-50 font-bold text-xs"
                            >
                                <History size={14} className="text-indigo-500" />
                                Global History
                            </Button>

                            <Badge
                                variant={isConnected ? "secondary" : "destructive"}
                                className={cn(
                                    "gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold transition-all shadow-sm ring-1",
                                    isConnected ? "bg-emerald-50 text-emerald-700 ring-emerald-100 hover:bg-emerald-100/50" : "animate-pulse"
                                )}
                            >
                                <span className={cn(
                                    "flex h-2 w-2 rounded-full",
                                    isConnected ? "bg-emerald-500" : "bg-white"
                                )}></span>
                                {isConnected ? 'SYSTEM OPERATIONAL' : 'SYSTEM OFFLINE'}
                            </Badge>
                        </div>
                    </div>
                </div>
            </nav>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                <div className="flex flex-col gap-10 items-stretch">
                    {/* Top Row: Management Tools */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between mb-8 px-2">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-indigo-100/50 rounded-lg text-indigo-600">
                                    <Package size={20} strokeWidth={2.5} />
                                </div>
                                <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                                    Project Management
                                </h2>
                            </div>
                        </div>
                        <ProjectList
                            refreshTrigger={refreshProjectsTrigger}
                            onRunProject={handleRunProject}
                        />
                    </div>

                    {/* Bottom Row: Agent Grid */}
                    <div>
                        <div className="flex items-center justify-between mb-8 px-2">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-slate-200/50 rounded-lg text-slate-600">
                                    <LayoutGrid size={20} strokeWidth={2.5} />
                                </div>
                                <h2 className="text-2xl font-black text-slate-900 tracking-tight">
                                    Fleet Manager
                                </h2>
                            </div>
                            <Badge variant="outline" className="bg-white shadow-sm border-slate-200 text-slate-600 font-bold px-4 py-1.5 rounded-full text-[11px] tracking-tight">
                                {agents.length} AGENTS ACTIVE
                            </Badge>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
                            {agents.map(agent => (
                                <AgentCard
                                    key={agent.id}
                                    agent={agent}
                                    onControlDevice={handleControlDevice}
                                />
                            ))}

                            {agents.length === 0 && (
                                <div className="col-span-full flex flex-col items-center justify-center py-32 bg-white/50 rounded-[2rem] border-2 border-dashed border-slate-200 animate-in zoom-in-95 duration-700">
                                    <div className="bg-slate-100 p-6 rounded-full mb-6 ring-8 ring-slate-50">
                                        <Server size={40} className="text-slate-300" />
                                    </div>
                                    <p className="text-slate-900 text-xl font-bold tracking-tight">No Active Agents</p>
                                    <p className="text-slate-500 text-sm mt-2 max-w-sm text-center leading-relaxed font-medium">
                                        Connect an agent to start managing devices. <br />Devices will automatically appear here once detected.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>

            {/* Dialogs */}
            <GlobalHistoryDialog
                isOpen={globalHistoryOpen}
                onClose={() => setGlobalHistoryOpen(false)}
            />

            {scriptRunnerOpen && (
                <ScriptRunnerDialog
                    isOpen={scriptRunnerOpen}
                    onClose={() => setScriptRunnerOpen(false)}
                    agents={agents}
                    socket={socket}
                    initialScriptId={selectedScriptId}
                />
            )}

            {selectedDevice && (
                <DeviceControlPanel
                    socket={socket}
                    agentId={selectedDevice.agentId}
                    deviceId={selectedDevice.deviceId}
                    initialTab={selectedDevice.initialTab}
                    onClose={() => setSelectedDevice(null)}
                />
            )}
            <Toaster position="bottom-right" theme="light" expand={true} richColors />
        </div>
    );
}
