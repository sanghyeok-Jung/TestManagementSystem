import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { Agent, Project } from '@qa/types';
import { Routes, Route, NavLink } from 'react-router-dom';
import { GlobalHistoryDialog } from './components/GlobalHistoryDialog';
import { SchedulesDialog } from './components/SchedulesDialog';
import { Activity, History, Calendar, LayoutDashboard, FileText } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Toaster } from 'sonner';

import { Dashboard } from './pages/Dashboard';
import { TestCasesPage } from './pages/TestCasesPage';

const socket = io({ transports: ['websocket'] });

export default function App() {
    const [isConnected, setIsConnected] = useState(socket.connected);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [globalHistoryOpen, setGlobalHistoryOpen] = useState(false);
    const [schedulesOpen, setSchedulesOpen] = useState(false);
    const [refreshProjectsTrigger, setRefreshProjectsTrigger] = useState(0);

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
            fetchProjects(); // Refresh full project list
        }

        async function fetchProjects() {
            try {
                const response = await fetch('/api/projects');
                if (response.ok) {
                    const data = await response.json();
                    setProjects(data);
                }
            } catch (error) {
                console.error("Failed to fetch projects", error);
            }
        }
        fetchProjects();

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

    return (
        <div className="min-h-screen bg-slate-50/50 text-slate-900 font-sans selection:bg-blue-100 selection:text-blue-900">
            {/* Navbar */}
            <nav className="bg-white/80 border-b border-slate-200 sticky top-0 z-30 backdrop-blur-md shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between items-center h-16">
                        <div className="flex items-center gap-8">
                            <div className="flex items-center gap-3">
                                <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-2 rounded-xl text-white shadow-lg shadow-blue-200/50">
                                    <Activity size={20} strokeWidth={2.5} />
                                </div>
                                <div className="flex flex-col">
                                    <span className="font-bold text-lg tracking-tight leading-none text-slate-900">QA Lab <span className="text-blue-600">Orchestrator</span></span>
                                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Distributed Test System</span>
                                </div>
                            </div>

                            <div className="hidden md:flex gap-1 items-center h-full ml-4">
                                <NavLink 
                                    to="/" 
                                    className={({isActive}) => cn(
                                        "px-3 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-colors",
                                        isActive ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                                    )}
                                >
                                    <LayoutDashboard size={16} />
                                    Dashboard
                                </NavLink>
                                <NavLink 
                                    to="/test-cases" 
                                    className={({isActive}) => cn(
                                        "px-3 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-colors",
                                        isActive ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                                    )}
                                >
                                    <FileText size={16} />
                                    Test Cases
                                </NavLink>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSchedulesOpen(true)}
                                className="h-8 gap-2 px-3 text-slate-600 border-slate-200 hover:bg-slate-50 font-bold text-xs"
                            >
                                <Calendar size={14} className="text-blue-500" />
                                Schedules
                            </Button>
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

            <Routes>
                <Route path="/" element={
                    <Dashboard 
                        socket={socket} 
                        agents={agents} 
                        projects={projects} 
                        refreshProjectsTrigger={refreshProjectsTrigger} 
                    />
                } />
                <Route path="/test-cases" element={<TestCasesPage projects={projects} />} />
            </Routes>

            {/* Dialogs */}
            <SchedulesDialog
                isOpen={schedulesOpen}
                onClose={() => setSchedulesOpen(false)}
                projects={projects}
                agents={agents}
            />

            <GlobalHistoryDialog
                isOpen={globalHistoryOpen}
                onClose={() => setGlobalHistoryOpen(false)}
            />

            <Toaster position="bottom-right" theme="light" expand={true} richColors />
        </div>
    );
}
