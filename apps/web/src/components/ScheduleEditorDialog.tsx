import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Agent, Project, TestSchedule, SelectedScriptInstance } from '@qa/types';
import { toast } from 'sonner';
import { Server as ServerIcon, Smartphone, FileCode, Plus, X, Variable, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ScheduleEditorDialogProps {
    isOpen: boolean;
    onClose: () => void;
    schedule?: TestSchedule;
    projects: Project[];
    agents: Agent[];
    onSaved: () => void;
}

export function ScheduleEditorDialog({ isOpen, onClose, schedule, projects, agents, onSaved }: ScheduleEditorDialogProps) {
    const isEdit = !!schedule;
    const [name, setName] = useState('');
    const [scriptId, setScriptId] = useState('');
    const [cronExpression, setCronExpression] = useState('0 9 * * *');
    const [targets, setTargets] = useState<{ agentId: string, deviceId: string | null }[]>([]);
    const [isActive, setIsActive] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const [selectedScripts, setSelectedScripts] = useState<SelectedScriptInstance[]>([]);
    const [command, setCommand] = useState('');

    useEffect(() => {
        if (isOpen && schedule) {
            setName(schedule.name);
            setScriptId(schedule.scriptId);
            setCronExpression(schedule.cronExpression);
            setTargets(schedule.targets);
            setIsActive(schedule.isActive);
            setSelectedScripts(schedule.selectedScripts || []);
            setCommand(schedule.command || '');
        } else if (isOpen && !schedule) {
            setName('');
            setScriptId('');
            setCronExpression('0 9 * * *');
            setTargets([]);
            setIsActive(true);
            setSelectedScripts([]);
            setCommand('');
        }
    }, [isOpen, schedule]);

    // Build the combined command whenever selected scripts change
    useEffect(() => {
        const project = projects.find(p => p.id === scriptId);
        if (project && project.metadata?.scripts && selectedScripts.length > 0) {
            const combinedCommand = selectedScripts.map(instance => {
                const script = project.metadata!.scripts![instance.scriptIndex];
                let cmd = script.command;
                if (instance.parameters && instance.parameters.length > 0) {
                    const paramsString = instance.parameters
                        .filter(p => p.key.trim() !== '')
                        .map(p => {
                            const val = p.value || '';
                            const safeVal = val.includes(' ') ? `"${val}"` : val;
                            return `--${p.key}=${safeVal}`;
                        })
                        .join(' ');
                    if (paramsString) {
                        const requiresSeparator = cmd.startsWith('npm ') || cmd.startsWith('yarn ') || cmd.startsWith('pnpm ');
                        cmd += requiresSeparator ? ` -- ${paramsString}` : ` ${paramsString}`;
                    }
                }
                return cmd;
            }).join(' && ');

            setCommand(combinedCommand);
        } else if (selectedScripts.length === 0) {
            setCommand('');
        }
    }, [selectedScripts, scriptId, projects]);

    const handleSave = async () => {
        if (!name || !scriptId || !cronExpression || targets.length === 0 || !command) {
            toast.error('Please fill in all required fields, select at least one target and choose a script to run.');
            return;
        }

        setIsSaving(true);
        try {
            const data = {
                name, scriptId, cronExpression, targets, isActive, command, selectedScripts
            };
            const url = isEdit ? `/api/schedules/${schedule.id}` : '/api/schedules';
            const method = isEdit ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (res.ok) {
                toast.success(`Schedule ${isEdit ? 'updated' : 'created'}`);
                onSaved();
                onClose();
            } else {
                const err = await res.json();
                toast.error(err.error || 'Failed to save schedule');
            }
        } catch (error) {
            toast.error('Error saving schedule');
        } finally {
            setIsSaving(false);
        }
    };

    const toggleTarget = (agentId: string, deviceId: string | null) => {
        setTargets(prev => {
            const exists = prev.some(t => t.agentId === agentId && t.deviceId === deviceId);
            if (exists) {
                return prev.filter(t => !(t.agentId === agentId && t.deviceId === deviceId));
            }
            return [...prev, { agentId, deviceId }];
        });
    };

    const addScriptToSequence = (scriptIndex: number) => {
        const project = projects.find(p => p.id === scriptId);
        if (!project || !project.metadata || !project.metadata.scripts) return;

        const scriptDef = project.metadata.scripts[scriptIndex];
        const initialParams = (scriptDef.parameters || []).map((p: any) => ({
            key: p.key,
            value: p.defaultValue || '',
            options: p.options,
            description: p.description,
            required: p.required
        }));

        setSelectedScripts(prev => [...prev, {
            scriptIndex,
            parameters: initialParams
        }]);
    };

    const removeScriptFromSequence = (sequenceIndex: number) => {
        setSelectedScripts(prev => prev.filter((_, i) => i !== sequenceIndex));
    };

    const moveScript = (sequenceIndex: number, direction: 'up' | 'down') => {
        setSelectedScripts(prev => {
            if (direction === 'up' && sequenceIndex > 0) {
                const newArr = [...prev];
                [newArr[sequenceIndex - 1], newArr[sequenceIndex]] = [newArr[sequenceIndex], newArr[sequenceIndex - 1]];
                return newArr;
            } else if (direction === 'down' && sequenceIndex < prev.length - 1) {
                const newArr = [...prev];
                [newArr[sequenceIndex + 1], newArr[sequenceIndex]] = [newArr[sequenceIndex], newArr[sequenceIndex + 1]];
                return newArr;
            }
            return prev;
        });
    };

    const addInstanceParameter = (sequenceIndex: number) => {
        setSelectedScripts(prev => {
            const newArr = [...prev];
            newArr[sequenceIndex].parameters.push({ key: '', value: '' });
            return newArr;
        });
    };

    const updateInstanceParameter = (sequenceIndex: number, paramIndex: number, field: 'key' | 'value', val: string) => {
        setSelectedScripts(prev => {
            const newArr = [...prev];
            newArr[sequenceIndex].parameters[paramIndex][field] = val;
            return newArr;
        });
    };

    const removeInstanceParameter = (sequenceIndex: number, paramIndex: number) => {
        setSelectedScripts(prev => {
            const newArr = [...prev];
            newArr[sequenceIndex].parameters = newArr[sequenceIndex].parameters.filter((_, i) => i !== paramIndex);
            return newArr;
        });
    };

    const currentProject = projects.find(p => p.id === scriptId);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{isEdit ? 'Edit Schedule' : 'Create New Schedule'}</DialogTitle>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    <div className="space-y-2">
                        <Label>Schedule Name</Label>
                        <Input
                            placeholder="Daily Regression Test"
                            value={name}
                            onChange={e => setName(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Project Component</Label>
                            <select
                                className="flex h-10 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-neutral-700"
                                value={scriptId}
                                onChange={e => {
                                    setScriptId(e.target.value);
                                    setSelectedScripts([]); // Reset sequence when project changes
                                }}
                            >
                                <option value="">Select a project</option>
                                {projects.filter(p => p.status === 'ready').map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <Label>Cron Expression</Label>
                            <Input
                                placeholder="0 9 * * *"
                                value={cronExpression}
                                onChange={e => setCronExpression(e.target.value)}
                            />
                            <p className="text-xs text-neutral-500">Min Hour Day Month Weekday (e.g., 0 9 * * * for 9:00 AM daily)</p>
                        </div>
                    </div>

                    {scriptId && (
                        <div className="grid gap-2 border-t border-neutral-800 pt-4">
                            <label className="text-sm font-medium leading-none flex items-center justify-between text-black">
                                <span>Build Execution Sequence</span>
                            </label>

                            <div className="flex flex-col gap-2">
                                {/* Available Scripts Pool */}
                                <div className="border border-neutral-800 rounded-md bg-neutral-900/50 p-3">
                                    <div className="text-[10px] uppercase font-bold text-white mb-2 tracking-wider flex items-center gap-1">
                                        <FileCode size={12} /> Available Scripts
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {currentProject?.metadata?.scripts?.map((script, idx) => (
                                            <TooltipProvider delayDuration={300} key={idx}>
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="text-xs h-7 bg-transparent border-neutral-700 text-neutral-300 hover:border-blue-500 hover:bg-blue-500/10 hover:text-blue-400"
                                                            onClick={() => addScriptToSequence(idx)}
                                                        >
                                                            <Plus size={12} className="mr-1" />
                                                            {script.name}
                                                        </Button>
                                                    </TooltipTrigger>
                                                    {script.description && (
                                                        <TooltipContent className="max-w-xs text-xs bg-neutral-800 text-neutral-200 border-neutral-700">
                                                            <p>{script.description}</p>
                                                        </TooltipContent>
                                                    )}
                                                </Tooltip>
                                            </TooltipProvider>
                                        ))}
                                        {(!currentProject?.metadata?.scripts || currentProject.metadata.scripts.length === 0) && (
                                            <div className="text-xs italic text-neutral-500 text-center py-2 w-full">
                                                No scripts found in project metadata.
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Current Sequence List */}
                                <div className="border border-neutral-700/50 rounded-md bg-neutral-950 p-3 min-h-[60px] max-h-[300px] overflow-y-auto">
                                    <div className="text-[10px] uppercase font-bold text-white mb-2 tracking-wider flex justify-between">
                                        <span>Current Sequence</span>
                                    </div>

                                    {selectedScripts.length === 0 ? (
                                        <div className="text-xs italic text-neutral-600 text-center py-4">
                                            Click an available script to add it to the sequence.
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {selectedScripts.map((instance, sequenceIdx) => {
                                                const scriptIdx = instance.scriptIndex;
                                                const script = currentProject?.metadata?.scripts?.[scriptIdx];
                                                if (!script) return null;

                                                return (
                                                    <div key={`${scriptIdx}-${sequenceIdx}`} className="flex flex-col bg-neutral-900 border border-neutral-800 rounded shadow-sm text-xs">
                                                        {/* Header: Sequence Number, Name, Actions */}
                                                        <div className="flex items-center justify-between p-2 border-b border-neutral-800 bg-neutral-900/80">
                                                            <div className="flex items-center gap-2 overflow-hidden">
                                                                <span className="bg-blue-500/20 text-blue-400 border border-blue-500/20 text-[10px] font-bold px-1.5 py-0.5 rounded-sm shrink-0">
                                                                    {sequenceIdx + 1}
                                                                </span>
                                                                <span className="truncate font-medium text-neutral-200">
                                                                    {script.name}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center shrink-0">
                                                                <button
                                                                    onClick={() => moveScript(sequenceIdx, 'up')}
                                                                    disabled={sequenceIdx === 0}
                                                                    className={`p-1 text-neutral-500 hover:text-blue-400 hover:bg-neutral-800 rounded ${sequenceIdx === 0 ? 'opacity-30 cursor-not-allowed' : ''}`}
                                                                >
                                                                    ▲
                                                                </button>
                                                                <button
                                                                    onClick={() => moveScript(sequenceIdx, 'down')}
                                                                    disabled={sequenceIdx === selectedScripts.length - 1}
                                                                    className={`p-1 text-neutral-500 hover:text-blue-400 hover:bg-neutral-800 rounded ${sequenceIdx === selectedScripts.length - 1 ? 'opacity-30 cursor-not-allowed' : ''}`}
                                                                >
                                                                    ▼
                                                                </button>
                                                                <div className="w-px h-3 bg-neutral-700 mx-1"></div>
                                                                <button
                                                                    onClick={() => removeScriptFromSequence(sequenceIdx)}
                                                                    className="p-1 text-neutral-500 hover:text-red-400 hover:bg-red-950/30 rounded text-[10px]"
                                                                >
                                                                    <X size={12} />
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Script Specific Parameters */}
                                                        <div className="p-3 space-y-3 bg-neutral-900/50 rounded-b">
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-[10px] uppercase font-bold text-neutral-500 tracking-wider flex items-center gap-1">
                                                                    <Variable size={10} /> Parameters
                                                                </span>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="h-6 text-[10px] px-2 py-0 text-blue-400 hover:bg-neutral-800 hover:text-blue-300"
                                                                    onClick={() => addInstanceParameter(sequenceIdx)}
                                                                >
                                                                    <Plus size={10} className="mr-0.5" /> Add
                                                                </Button>
                                                            </div>

                                                            {instance.parameters.length === 0 ? (
                                                                <div className="text-[10px] text-neutral-600 italic">No parameters</div>
                                                            ) : (
                                                                <div className="space-y-2">
                                                                    <TooltipProvider delayDuration={300}>
                                                                        {instance.parameters.map((param, paramIdx) => (
                                                                            <div key={paramIdx} className="flex items-center gap-2">
                                                                                {param.description ? (
                                                                                    <Tooltip>
                                                                                        <TooltipTrigger asChild>
                                                                                            <div className="relative flex-[0.8] group">
                                                                                                <Input
                                                                                                    value={param.key}
                                                                                                    onChange={(e) => updateInstanceParameter(sequenceIdx, paramIdx, 'key', e.target.value)}
                                                                                                    placeholder="key"
                                                                                                    className="h-7 text-[10px] pr-6 bg-neutral-950 border-neutral-800 text-neutral-200"
                                                                                                />
                                                                                                <Info className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-blue-400/50 group-hover:text-blue-400 transition-colors" />
                                                                                            </div>
                                                                                        </TooltipTrigger>
                                                                                        <TooltipContent side="top" className="max-w-xs text-xs bg-neutral-800 text-neutral-200 border-neutral-700">
                                                                                            <p>{param.description}</p>
                                                                                        </TooltipContent>
                                                                                    </Tooltip>
                                                                                ) : (
                                                                                    <Input
                                                                                        value={param.key}
                                                                                        onChange={(e) => updateInstanceParameter(sequenceIdx, paramIdx, 'key', e.target.value)}
                                                                                        placeholder="key"
                                                                                        className="h-7 text-[10px] flex-[0.8] bg-neutral-950 border-neutral-800 text-neutral-200"
                                                                                    />
                                                                                )}

                                                                                <span className="text-neutral-600 text-xs font-bold">=</span>

                                                                                {param.options && param.options.length > 0 ? (
                                                                                    <select
                                                                                        value={param.value}
                                                                                        onChange={(e) => updateInstanceParameter(sequenceIdx, paramIdx, 'value', e.target.value)}
                                                                                        className="flex h-7 flex-1 items-center justify-between rounded-md border border-neutral-800 bg-neutral-950 px-2 py-0 text-[10px] text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-700"
                                                                                    >
                                                                                        <option value="" disabled>Select...</option>
                                                                                        {param.options.map((opt, i) => (
                                                                                            <option key={i} value={opt}>{opt}</option>
                                                                                        ))}
                                                                                    </select>
                                                                                ) : (
                                                                                    <Input
                                                                                        value={param.value}
                                                                                        onChange={(e) => updateInstanceParameter(sequenceIdx, paramIdx, 'value', e.target.value)}
                                                                                        placeholder="value"
                                                                                        className="h-7 text-[10px] flex-1 bg-neutral-950 border-neutral-800 text-neutral-200"
                                                                                    />
                                                                                )}

                                                                                <button
                                                                                    onClick={() => removeInstanceParameter(sequenceIdx, paramIdx)}
                                                                                    className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-neutral-800 rounded translate-y-[1px]"
                                                                                >
                                                                                    <X size={12} />
                                                                                </button>
                                                                            </div>
                                                                        ))}
                                                                    </TooltipProvider>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                                <div className="space-y-2 mt-2">
                                    <Label className="text-xs text-neutral-400">Generated Command</Label>
                                    <Input
                                        value={command}
                                        onChange={(e) => setCommand(e.target.value)}
                                        placeholder="Command will be generated here"
                                        readOnly={true}
                                        className="bg-neutral-950 border-neutral-800 text-neutral-400 font-mono text-xs cursor-not-allowed opacity-70"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="space-y-3 pt-4 border-t border-neutral-800">
                        <Label>Execution Targets ({targets.length} selected)</Label>
                        <div className="space-y-4">
                            {agents.map(agent => (
                                <div key={agent.id} className="p-4 bg-neutral-800/50 border border-neutral-700 rounded-lg">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center gap-2">
                                            <ServerIcon className={agent.status === 'online' ? "w-4 h-4 text-green-500" : "w-4 h-4 text-neutral-400"} />
                                            <span className="font-medium text-white">{agent.hostname}</span>
                                            <Badge variant="outline" className="ml-2 text-xs border-neutral-600 text-neutral-300">
                                                {agent.ip}
                                            </Badge>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mt-2">
                                        {/* Agent Environment Target */}
                                        <div
                                            onClick={() => toggleTarget(agent.id, null)}
                                            className={`flex items-center gap-2 p-2 px-3 rounded-md border cursor-pointer transition-colors ${targets.some(t => t.agentId === agent.id && t.deviceId === null) ? 'bg-blue-400 border-blue-500 text-neutral-950 hover:bg-blue-500' : 'bg-neutral-900 border-neutral-700 hover:border-neutral-600 text-neutral-200'}`}
                                        >
                                            <ServerIcon className="w-4 h-4 shrink-0" />
                                            <div className="flex flex-col overflow-hidden leading-tight">
                                                <span className={`text-sm font-medium truncate ${targets.some(t => t.agentId === agent.id && t.deviceId === null) ? 'text-neutral-950' : 'text-white'}`}>Agent VM</span>
                                                <span className={`text-[10px] truncate ${targets.some(t => t.agentId === agent.id && t.deviceId === null) ? 'text-neutral-800' : 'text-neutral-500'}`}>(No Device)</span>
                                            </div>
                                        </div>
                                    </div>
                                    {agent.devices && agent.devices.length > 0 && (
                                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mt-2 border-t border-neutral-700/50 pt-2">
                                            {agent.devices.map(device => {
                                                const isSelected = targets.some(t => t.agentId === agent.id && t.deviceId === device.id);
                                                return (
                                                    <div
                                                        key={device.id}
                                                        onClick={() => toggleTarget(agent.id, device.id)}
                                                        className={`flex items-center gap-2 p-2 px-3 rounded-md border cursor-pointer transition-colors ${isSelected ? 'bg-blue-400 border-blue-500 text-neutral-950 hover:bg-blue-500' : 'bg-neutral-900 border-neutral-700 hover:border-neutral-600 text-neutral-200'}`}
                                                    >
                                                        <Smartphone className="w-4 h-4 shrink-0" />
                                                        <div className="flex flex-col overflow-hidden leading-tight">
                                                            <span className={`text-sm font-medium truncate ${isSelected ? 'text-neutral-950' : 'text-white'}`}>{device.model}</span>
                                                            <span className={`text-xs truncate ${isSelected ? 'text-neutral-800' : 'text-neutral-400'}`}>{device.id}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center space-x-2 pt-4 border-t border-neutral-800">
                        <input
                            type="checkbox"
                            id="isActive"
                            checked={isActive}
                            onChange={e => setIsActive(e.target.checked)}
                            className="w-4 h-4 rounded bg-neutral-900 border-neutral-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-neutral-950"
                        />
                        <Label htmlFor="isActive">Activate schedule immediately</Label>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSave} disabled={isSaving}>
                        {isSaving ? 'Saving...' : 'Save Schedule'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
