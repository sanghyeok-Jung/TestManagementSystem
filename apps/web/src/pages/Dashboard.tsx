import { useState } from 'react';
import { Socket } from 'socket.io-client';
import { Agent, Project } from '@qa/types';
import { ProjectList } from '../components/ProjectList';
import { AgentCard } from '../components/AgentCard';
import { DeviceControlPanel } from '../components/DeviceControlPanel';
import { NodeFarmPanel } from '../components/NodeFarmPanel';
import { ScriptRunnerDialog } from '../components/ScriptRunnerDialog';
import { Server, LayoutGrid, Package } from 'lucide-react';
import { Badge } from "@/components/ui/badge";

interface DashboardProps {
    socket: Socket;
    agents: Agent[];
    projects: Project[];
    refreshProjectsTrigger: number;
}

export function Dashboard({ socket, agents, projects, refreshProjectsTrigger }: DashboardProps) {
    const [selectedDevice, setSelectedDevice] = useState<{ agentId: string, deviceId: string, platform: 'android' | 'ios', initialTab?: 'control' | 'history' } | null>(null);
    const [selectedAgent, setSelectedAgent] = useState<{ agentId: string, initialTab?: 'control' | 'history' } | null>(null);
    const [scriptRunnerOpen, setScriptRunnerOpen] = useState(false);
    const [selectedScriptId, setSelectedScriptId] = useState<string>('');

    const handleControlDevice = (agentId: string, deviceId: string | null, tab?: 'control' | 'history') => {
        if (deviceId) {
            const agent = agents.find(a => a.id === agentId);
            const device = agent?.devices.find(d => d.id === deviceId);
            setSelectedDevice({ 
                agentId, 
                deviceId, 
                platform: (device?.platform as 'android' | 'ios') || 'android', 
                initialTab: tab 
            });
        } else {
            setSelectedAgent({ agentId, initialTab: tab });
        }
    };

    const handleRunProject = (project: Project) => {
        setSelectedScriptId(project.id);
        setScriptRunnerOpen(true);
    };

    return (
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
                    platform={selectedDevice.platform}
                    initialTab={selectedDevice.initialTab}
                    onClose={() => setSelectedDevice(null)}
                />
            )}

            {selectedAgent && (
                <NodeFarmPanel
                    socket={socket}
                    agent={agents.find(a => a.id === selectedAgent.agentId)!}
                    initialTab={selectedAgent.initialTab}
                    onClose={() => setSelectedAgent(null)}
                />
            )}
        </main>
    );
}
