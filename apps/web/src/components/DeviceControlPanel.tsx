import React, { useRef, useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import { DevicePlayer } from './DevicePlayer';
import { ShellTerminal } from './ShellTerminal';
import { LogcatViewer, LogcatViewerHandle } from './LogcatViewer';
import { Play, Pause, Trash, MousePointer2, Upload, Download, Loader2, Eraser, Power, Volume2, Volume1, Home, ChevronLeft, Lock, RotateCw, AppWindow, SendHorizontal } from 'lucide-react';
import { DeviceHistoryPanel } from './DeviceHistoryPanel';
import { cn } from "@/lib/utils";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

interface DeviceControlPanelProps {
    socket: Socket;
    agentId: string;
    deviceId: string;
    platform: 'android' | 'ios';
    initialTab?: 'control' | 'history';
    onClose: () => void;
}

export const DeviceControlPanel: React.FC<DeviceControlPanelProps> = ({ socket, agentId, deviceId, platform, initialTab = 'control', onClose }) => {
    const logcatRef = useRef<LogcatViewerHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const installInputRef = useRef<HTMLInputElement>(null);

    const [isLogcatRunning, setIsLogcatRunning] = useState(false);
    const [isLogcatAutoScroll, setIsLogcatAutoScroll] = useState(true);
    const [isTransferring, setIsTransferring] = useState(false);
    const [occupancy, setOccupancy] = useState<Record<string, string>>({});
    const [isLoadingOccupancy, setIsLoadingOccupancy] = useState(true);
    const [activeTab, setActiveTab] = useState<'control' | 'history'>(initialTab);
    const [sendTextValue, setSendTextValue] = useState('');

    const deviceOwnerId = occupancy[deviceId];
    const isBusy = !!deviceOwnerId && deviceOwnerId !== socket.id;

    useEffect(() => {
        const handlePushStatus = (data: { deviceId: string, success: boolean, error?: string, filename?: string }) => {
            if (data.deviceId === deviceId) {
                setIsTransferring(false);
                if (data.success) {
                    toast.success(`Pushed ${data.filename} successfully`);
                } else {
                    toast.error(`Push failed: ${data.error}`);
                }
            }
        };

        const handlePullComplete = (data: { deviceId: string, fileId: string, filename: string }) => {
            if (data.deviceId === deviceId) {
                setIsTransferring(false);
                toast.success(`Pulled ${data.filename} successfully. Downloading...`);
                // Trigger browser download
                const link = document.createElement('a');
                link.href = `/api/download/${data.fileId}`;
                link.download = data.filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        };

        const handleOccupancy = (data: Record<string, string>) => {
            setOccupancy(data);
            setIsLoadingOccupancy(false);
        };

        const handleInstallStatus = (data: { deviceId: string, success: boolean, error?: string, filename?: string }) => {
            if (data.deviceId === deviceId) {
                setIsTransferring(false);
                if (data.success) {
                    toast.success(`Installed ${data.filename} successfully`);
                } else {
                    toast.error(`Install failed: ${data.error}`);
                }
            }
        };

        socket.on('adb_push_status', handlePushStatus);
        socket.on('adb_pull_complete', handlePullComplete);
        socket.on('occupancy_updated', handleOccupancy);
        socket.on('adb_install_status', handleInstallStatus);

        // Request initial status
        socket.emit('get_occupancy');

        return () => {
            socket.off('adb_push_status', handlePushStatus);
            socket.off('adb_pull_complete', handlePullComplete);
            socket.off('occupancy_updated', handleOccupancy);
            socket.off('adb_install_status', handleInstallStatus);
        };
    }, [deviceId, socket]);

    const handleToggleLogcat = () => {
        if (logcatRef.current) {
            logcatRef.current.toggleRun();
            setIsLogcatRunning(!isLogcatRunning);
        }
    };

    const handleToggleLogcatAutoScroll = () => {
        if (logcatRef.current) {
            logcatRef.current.toggleAutoScroll();
            setIsLogcatAutoScroll(!isLogcatAutoScroll);
        }
    };

    const handleClearLogcat = () => {
        if (logcatRef.current) {
            logcatRef.current.clearLogs();
        }
    };

    const handlePushClick = () => {
        fileInputRef.current?.click();
    };

    const handleInstallClick = () => {
        installInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsTransferring(true);
        toast.info(`Uploading ${file.name}...`);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();
            if (result.success) {
                toast.info(`Pushing ${file.name} to device...`);
                socket.emit('adb_push', {
                    agentId,
                    deviceId,
                    fileId: result.scriptId,
                    filename: file.name
                });
            } else {
                toast.error('Upload failed');
                setIsTransferring(false);
            }
        } catch (error) {
            console.error('Push failed:', error);
            toast.error('System error during push');
            setIsTransferring(false);
        }
    };

    const handleInstallFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!file.name.endsWith('.apk') && !file.name.endsWith('.aab')) {
            toast.error('Only .apk and .aab files are supported');
            return;
        }

        setIsTransferring(true);
        toast.info(`Uploading ${file.name}...`);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();
            if (result.success) {
                toast.info(`Installing ${file.name} on device...`);
                socket.emit('adb_install', {
                    agentId,
                    deviceId,
                    fileId: result.scriptId,
                    filename: file.name
                });
            } else {
                toast.error('Upload failed');
                setIsTransferring(false);
            }
        } catch (error) {
            console.error('Install failed:', error);
            toast.error('System error during install');
            setIsTransferring(false);
        }
    };

    const handlePullClick = () => {
        const remotePath = window.prompt("Enter remote path to pull (e.g. /system/build.prop):", "/sdcard/Download/");
        if (!remotePath) return;

        setIsTransferring(true);
        toast.info(`Pulling ${remotePath}...`);
        socket.emit('adb_pull', {
            agentId,
            deviceId,
            remotePath
        });
    };

    const handleRemoveAllPackages = () => {
        if (!window.confirm("Are you sure you want to remove all 3rd-party packages for user 0?")) return;

        // Command to run inside the adb shell
        const cmd = "pm list packages -3 --user 0 | cut -d ':' -f 2 | tr -d '\\r' | xargs -n1 pm uninstall --user 0\n";
        socket.emit('shell_input', {
            agentId,
            deviceId,
            input: cmd
        });
        toast.info("Sent package removal command to terminal");
    };

    const handleRotate = () => {
        socket.emit('device_input', {
            agentId, deviceId,
            type: 'rotate'
        });
    };

    const handleKeyPress = (keycode: number) => {
        socket.emit('device_input', {
            agentId, deviceId,
            type: 'key',
            keycode
        });
    };

    return (
        <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className={cn(
                "max-w-[95vw] h-[90vh] p-0 gap-0 overflow-hidden bg-slate-50/50 backdrop-blur-xl border-slate-200/50 shadow-2xl ring-1 ring-black/5 flex flex-col focus-visible:outline-none",
                platform === 'android' ? "w-[1400px]" : "w-[500px]"
            )}>
                <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    onChange={handleFileChange}
                />
                <input
                    type="file"
                    ref={installInputRef}
                    className="hidden"
                    accept=".apk,.aab"
                    onChange={handleInstallFileChange}
                />

                <DialogHeader className="px-6 py-4 bg-white/80 backdrop-blur-md border-b border-slate-200/50 flex-none flex flex-row items-center justify-between">
                    <div className="space-y-1">
                        <DialogTitle className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-4">
                            Device Controller
                            <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                                <button
                                    onClick={() => setActiveTab('control')}
                                    className={cn(
                                        "px-3 py-1 text-[11px] font-bold uppercase tracking-wider rounded-md transition-all flex items-center gap-2",
                                        activeTab === 'control' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                                    )}
                                >
                                    <Power size={14} />
                                    Live Control
                                </button>
                                <button
                                    onClick={() => setActiveTab('history')}
                                    className={cn(
                                        "px-3 py-1 text-[11px] font-bold uppercase tracking-wider rounded-md transition-all flex items-center gap-2",
                                        activeTab === 'history' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                                    )}
                                >
                                    <RotateCw size={14} />
                                    Automation History
                                </button>
                            </div>
                        </DialogTitle>
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono text-[10px] bg-slate-100/50 border-slate-200 text-slate-600">
                                {agentId}
                            </Badge>
                            <span className="text-slate-300">/</span>
                            <Badge variant="secondary" className="font-mono text-[10px] bg-blue-50 text-blue-600 border-blue-100">
                                {deviceId}
                            </Badge>
                        </div>
                    </div>
                </DialogHeader>

                {isLoadingOccupancy ? (
                    <div className="flex-1 flex flex-col items-center justify-center bg-slate-50/30">
                        <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-4" />
                        <p className="text-slate-500 text-sm">Checking device status...</p>
                    </div>
                ) : isBusy ? (
                    <div className="flex-1 flex flex-col items-center justify-center bg-slate-100/50 p-8 text-center animate-in fade-in duration-300">
                        <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mb-4">
                            <Lock size={32} className="text-slate-400" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-700 mb-2">Device is in use</h3>
                        <p className="text-slate-500 max-w-md">
                            This device is currently being controlled by another user.
                            You cannot view or interact with it until they are finished.
                        </p>
                    </div>
                ) : activeTab === 'history' ? (
                    <div className="flex-1 p-4 bg-slate-50/30 overflow-hidden min-h-0">
                        <DeviceHistoryPanel socket={socket} deviceId={deviceId} />
                    </div>
                ) : (
                    <div className="flex-1 grid grid-cols-12 gap-4 p-4 min-h-0 overflow-hidden bg-slate-50/30">
                        {/* Live Stream Section — full-width for iOS, left column for Android */}
                        <Card className={cn(
                            "h-full flex flex-col overflow-hidden border-slate-200/60 shadow-sm bg-white/50 backdrop-blur-sm",
                            platform === 'ios' ? "col-span-12" : "col-span-12 lg:col-span-4"
                        )}>
                            <div className="p-3 border-b border-slate-100 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                        Live Screen
                                    </h3>
                                </div>
                                <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg border border-slate-200">
                                    <Button disabled={isBusy} variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:text-red-500 hover:bg-red-50" onClick={() => handleKeyPress(platform === 'android' ? 26 : 0)} title="Power">
                                        <Power size={12} />
                                    </Button>
                                    <Button disabled={isBusy} variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:text-slate-700" onClick={() => handleKeyPress(24)} title="Volume Up">
                                        <Volume2 size={12} />
                                    </Button>
                                    <Button disabled={isBusy} variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:text-slate-700" onClick={() => handleKeyPress(25)} title="Volume Down">
                                        <Volume1 size={12} />
                                    </Button>
                                    <div className="w-px h-3 bg-slate-300" />
                                    {platform === 'android' && (
                                        <Button disabled={isBusy} variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:text-slate-700" onClick={() => handleKeyPress(187)} title="Recent Apps">
                                            <AppWindow size={12} />
                                        </Button>
                                    )}
                                    <Button disabled={isBusy} variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:text-slate-700" onClick={() => handleKeyPress(3)} title="Home">
                                        <Home size={12} />
                                    </Button>
                                    {platform === 'android' && (
                                        <Button disabled={isBusy} variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:text-slate-700" onClick={() => handleKeyPress(4)} title="Back">
                                            <ChevronLeft size={12} />
                                        </Button>
                                    )}
                                    {platform === 'android' && (
                                        <>
                                            <div className="w-px h-3 bg-slate-300" />
                                            <Button disabled={isBusy} variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:text-blue-500 hover:bg-blue-50" onClick={handleRotate} title="Rotate Screen (90°)">
                                                <RotateCw size={12} />
                                            </Button>
                                        </>
                                    )}
                                    {platform === 'ios' && (
                                        <>
                                            <div className="w-px h-3 bg-slate-300" />
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 text-slate-500 hover:text-emerald-500 hover:bg-emerald-50"
                                                onClick={handleInstallClick}
                                                disabled={isTransferring || isBusy}
                                                title="Install IPA"
                                            >
                                                {isTransferring ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} className="rotate-90" />}
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <DevicePlayer agentId={agentId} deviceId={deviceId} socket={socket} platform={platform} readonly={!!isBusy} />
                            </div>
                            {/* Text Send Bar */}
                            <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-slate-100 bg-slate-50/80">
                                <input
                                    type="text"
                                    value={sendTextValue}
                                    onChange={(e) => setSendTextValue(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && sendTextValue.trim()) {
                                            socket.emit('device_input', { agentId, deviceId, type: 'text', text: sendTextValue });
                                            setSendTextValue('');
                                        }
                                    }}
                                    disabled={isBusy}
                                    placeholder="Type text → Enter to send to device..."
                                    className="flex-1 text-[11px] px-2 py-1 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-slate-400"
                                />
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-6 w-6 text-slate-400 hover:text-blue-500 hover:bg-blue-50 flex-none"
                                    disabled={isBusy || !sendTextValue.trim()}
                                    onClick={() => {
                                        if (sendTextValue.trim()) {
                                            socket.emit('device_input', { agentId, deviceId, type: 'text', text: sendTextValue });
                                            setSendTextValue('');
                                        }
                                    }}
                                    title="Send text to device"
                                >
                                    <SendHorizontal size={12} />
                                </Button>
                            </div>
                        </Card>

                        {/* Controls Section (Column 2 - Android only) */}
                        {platform === 'android' && (
                        <div className="col-span-12 lg:col-span-8 h-full flex flex-col gap-4 min-h-0 overflow-hidden">
                            {/* Terminal Section (Top) */}
                            <Card className="flex-1 min-h-0 flex flex-col overflow-hidden border-slate-200/60 shadow-sm bg-slate-900 ring-1 ring-white/5">
                                <div className="p-3 border-b border-white/5 flex items-center justify-between">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">ADB Terminal</h3>

                                    <div className="flex items-center gap-1.5 p-0.5 bg-white/5 rounded-lg border border-white/10">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/10"
                                            onClick={handlePushClick}
                                            disabled={isTransferring || isBusy}
                                            title="Push file to /sdcard/Download"
                                        >
                                            {isTransferring ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/10"
                                            onClick={handleInstallClick}
                                            disabled={isTransferring || isBusy}
                                            title="Install APK/AAB"
                                        >
                                            {isTransferring ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} className="rotate-90" />}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/10"
                                            onClick={handlePullClick}
                                            disabled={isTransferring || isBusy}
                                            title="Pull file from device"
                                        >
                                            <Download size={14} />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-red-400/80 hover:text-red-400 hover:bg-red-400/10"
                                            onClick={handleRemoveAllPackages}
                                            disabled={isBusy}
                                            title="Remove all 3rd-party packages (user 0)"
                                        >
                                            <Eraser size={14} />
                                        </Button>
                                        <div className="w-px h-3 bg-white/10 mx-0.5" />
                                        <div className="px-2 text-[10px] font-bold text-slate-500 tracking-tight">FILES</div>
                                    </div>
                                </div>
                                <div className="flex-1 min-h-0 p-1">
                                    <ShellTerminal socket={socket} agentId={agentId} deviceId={deviceId} readonly={!!isBusy} />
                                </div>
                            </Card>

                            {/* Logcat Section (Bottom) */}
                            <Card className="flex-[1.5] min-h-0 flex flex-col overflow-hidden border-slate-200/60 shadow-sm bg-white">
                                <div className="p-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Live Logcat</h3>
                                    <div className="flex items-center gap-1.5 py-0.5 px-0.5 bg-slate-200/50 rounded-lg border border-slate-200/50">
                                        <Button
                                            variant={isLogcatAutoScroll ? "default" : "ghost"}
                                            size="sm"
                                            className={cn(
                                                "h-7 px-2 text-[10px] font-bold transition-all",
                                                isLogcatAutoScroll ? "bg-blue-600 hover:bg-blue-700 shadow-sm" : "text-slate-500"
                                            )}
                                            onClick={handleToggleLogcatAutoScroll}
                                        >
                                            <MousePointer2 size={12} className={cn("mr-1", isLogcatAutoScroll && "animate-bounce")} />
                                            AUTO
                                        </Button>

                                        <div className="w-px h-3 bg-slate-300 mx-0.5" />

                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className={cn(
                                                "h-7 w-7 transition-colors rounded-md",
                                                isLogcatRunning ? "text-red-500 hover:text-red-600 hover:bg-red-50" : "text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50"
                                            )}
                                            onClick={handleToggleLogcat}
                                            disabled={isBusy}
                                        >
                                            {isLogcatRunning ? <Pause size={14} /> : <Play size={14} />}
                                        </Button>

                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md"
                                            onClick={handleClearLogcat}
                                            disabled={isBusy}
                                        >
                                            <Trash size={14} />
                                        </Button>
                                    </div>
                                </div>
                                <div className="flex-1 min-h-0">
                                    <LogcatViewer ref={logcatRef} socket={socket} agentId={agentId} deviceId={deviceId} readonly={!!isBusy} />
                                </div>
                            </Card>
                        </div>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};
