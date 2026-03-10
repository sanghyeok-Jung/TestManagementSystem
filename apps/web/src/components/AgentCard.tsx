import React, { useState, useEffect, useRef } from 'react';
import { Agent } from '@qa/types';
import { Laptop, Smartphone, Wifi, WifiOff, Monitor, Loader2, MoreVertical, History, TerminalSquare } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AgentCardProps {
    agent: Agent;
    onControlDevice: (agentId: string, deviceId: string | null, tab?: 'control' | 'history') => void;
}

const AgentDeviceItem = ({ agentId, device, onControlDevice, onMenuToggle }: { agentId: string, device: any, onControlDevice: any, onMenuToggle: (isOpen: boolean) => void }) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const toggleMenu = (isOpen: boolean) => {
        setMenuOpen(isOpen);
        onMenuToggle(isOpen);
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                toggleMenu(false);
            }
        };

        if (menuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [menuOpen]);

    return (
        <div className={cn(
            "group/item relative flex items-center justify-between p-4 bg-white border border-slate-100 rounded-xl hover:border-blue-200 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5",
            menuOpen ? "z-50" : "z-10"
        )}>
            <div className="flex items-center gap-4">
                <div className="relative">
                    <div className="bg-slate-50 p-2.5 rounded-lg text-slate-600 group-hover/item:text-blue-600 group-hover/item:bg-blue-50 transition-colors">
                        {device.platform === 'ios' ? (
                            <Monitor size={20} strokeWidth={1.5} /> // Using Monitor or potentially Apple icon if available, but Monitor works as a substitute for now. Let's stick to Smartphone with an indicator or use a different icon.
                        ) : (
                            <Smartphone size={20} strokeWidth={1.5} />
                        )}
                    </div>
                    <div className={cn(
                        "absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-white transition-colors shadow-sm",
                        device.status === 'available' ? 'bg-emerald-500' :
                            device.status === 'busy' ? 'bg-amber-400' : 'bg-rose-400'
                    )} />
                </div>

                <div>
                    <div className="flex items-center gap-2">
                        <p className="font-bold text-slate-900 text-sm">{device.model}</p>
                        {device.jobStatus === 'running' && (
                            <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-none flex items-center gap-1 px-1.5 py-0 h-4 text-[9px] uppercase tracking-wider font-bold">
                                <Loader2 size={10} className="animate-spin" />
                                Running
                            </Badge>
                        )}
                        {device.queueLength && device.queueLength > 0 ? (
                            <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 border-none flex items-center gap-1 px-1.5 py-0 h-4 text-[9px] uppercase tracking-wider font-bold">
                                {device.queueLength} in Queue
                            </Badge>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-[10px] text-slate-400 font-mono uppercase tracking-wide">{device.id}</p>
                        {device.platform && device.osVersion && (
                            <>
                                <span className="text-[10px] text-slate-300">•</span>
                                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 rounded uppercase tracking-wider">
                                    {device.platform === 'ios' ? 'iOS' : 'Android'} {device.osVersion}
                                </span>
                            </>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2 relative pointer-events-auto opacity-100 lg:opacity-0 lg:group-hover/item:opacity-100 focus-within:opacity-100 transition-all duration-200" ref={menuRef}>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                    onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
                >
                    <MoreVertical size={16} />
                </Button>

                {menuOpen && (
                    <div
                        className="absolute right-0 top-10 w-44 bg-white border border-slate-200 shadow-xl rounded-xl py-1.5 z-50 animate-in fade-in zoom-in-95"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {device.platform === 'android' && (
                            <button
                                className="w-full text-left px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                onClick={() => { setMenuOpen(false); onControlDevice(agentId, device.id, 'control'); }}
                                disabled={device.status === 'offline'}
                            >
                                <div className="bg-blue-50 p-1.5 rounded-md text-blue-600">
                                    <Monitor size={14} />
                                </div>
                                Remote Control
                            </button>
                        )}
                        <button
                            className="w-full text-left px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors mt-0.5"
                            onClick={() => { setMenuOpen(false); onControlDevice(agentId, device.id, 'history'); }}
                        >
                            <div className="bg-indigo-50 p-1.5 rounded-md text-indigo-600">
                                <History size={14} />
                            </div>
                            Automation History
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export const AgentCard: React.FC<AgentCardProps> = ({ agent, onControlDevice }) => {
    const isOnline = agent.status === 'online';
    const [openMenuCount, setOpenMenuCount] = useState(0);

    const handleMenuToggle = (isOpen: boolean) => {
        setOpenMenuCount(prev => Math.max(0, isOpen ? prev + 1 : prev - 1));
    };

    return (
        <Card className={cn(
            "group transition-all duration-300 hover:shadow-xl hover:border-blue-200/50 bg-white/50 backdrop-blur-sm",
            openMenuCount > 0 ? "relative z-50" : "relative z-10"
        )}>
            {/* Status Indicator Top Bar */}
            <div className={cn(
                "h-1 w-full transition-colors duration-500 rounded-t-xl",
                isOnline ? "bg-blue-600" : "bg-slate-300"
            )} />

            <CardHeader className="flex flex-row items-start justify-between space-y-0 px-6 py-5">
                <div className="flex items-start gap-4">
                    <div className={cn(
                        "p-3 rounded-xl transition-all duration-300",
                        isOnline ? "bg-blue-50 text-blue-600 shadow-inner" : "bg-slate-50 text-slate-400"
                    )}>
                        <Laptop size={24} strokeWidth={1.5} />
                    </div>
                    <div className="space-y-1">
                        <CardTitle className="text-lg font-bold tracking-tight text-slate-900 leading-none">
                            {agent.hostname}
                        </CardTitle>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono font-medium text-slate-400 bg-slate-100/50 px-2 py-0.5 rounded">
                                {agent.ip}
                            </span>
                            <span className={cn(
                                "flex h-2 w-2 rounded-full",
                                isOnline ? "bg-emerald-500 animate-pulse" : "bg-slate-300"
                            )} />
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                            {agent.queueLength && agent.queueLength > 0 ? (
                                <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-100 border-none flex items-center gap-1 px-1.5 py-0 h-4 text-[9px] uppercase tracking-wider font-bold">
                                    Agent VM Queue: {agent.queueLength}
                                </Badge>
                            ) : null}
                        </div>
                    </div>
                </div>

                <Badge
                    variant={isOnline ? "secondary" : "outline"}
                    className={cn(
                        "gap-1.5 px-3 py-1 font-bold tracking-tight uppercase text-[10px]",
                        isOnline ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "text-slate-500"
                    )}
                >
                    {isOnline ? <Wifi size={12} strokeWidth={3} /> : <WifiOff size={12} strokeWidth={3} />}
                    {isOnline ? 'Online' : 'Offline'}
                </Badge>
            </CardHeader>

            <CardContent className="px-6 pb-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex flex-col gap-3 w-full">
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="w-full justify-start gap-2 h-9 border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-blue-600 transition-colors"
                                onClick={() => onControlDevice(agent.id, null, 'control')}
                                disabled={!isOnline}
                            >
                                <div className="bg-slate-100 p-1 rounded-md text-slate-500 group-hover:text-blue-500 transition-colors">
                                    <TerminalSquare size={14} />
                                </div>
                                <span className="font-bold text-[11px] tracking-wide">Node Environment</span>
                            </Button>
                        </div>

                        <div className="flex items-center gap-4 mt-2">
                            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                Connected Devices
                            </h4>
                            <Badge variant="secondary" className="h-5 px-1.5 font-mono font-bold bg-slate-100 text-slate-600">
                                {agent.devices.length}
                            </Badge>
                        </div>
                    </div>
                </div>

                {agent.devices.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 bg-slate-50/50 rounded-xl border border-dashed border-slate-200 text-center animate-in fade-in duration-500">
                        <div className="bg-white p-3 rounded-full mb-3 shadow-sm ring-1 ring-slate-200/50">
                            <Smartphone size={20} className="text-slate-300" />
                        </div>
                        <p className="text-sm font-semibold text-slate-500">Waiting for devices</p>
                        <p className="text-[11px] text-slate-400 mt-1">Connect via USB to get started</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {agent.devices.map(device => (
                            <AgentDeviceItem
                                key={device.id}
                                agentId={agent.id}
                                device={device}
                                onControlDevice={onControlDevice}
                                onMenuToggle={handleMenuToggle}
                            />
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};
