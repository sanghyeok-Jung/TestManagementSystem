import React, { useState, useEffect } from 'react';
import { Agent, Project } from '@qa/types';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Play, Loader2, FileCode, Terminal, Plus, X, Variable, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ScriptParameter {
    key: string;
    value: string;
    options?: string[];
    description?: string;
    required?: boolean;
}

interface ScriptRunnerDialogProps {
    isOpen: boolean;
    onClose: () => void;
    agents: Agent[];
    socket: any;
    initialScriptId?: string;
}

interface SelectedScriptInstance {
    scriptIndex: number;
    parameters: ScriptParameter[];
}

export const ScriptRunnerDialog: React.FC<ScriptRunnerDialogProps> = ({ isOpen, onClose, agents, initialScriptId }) => {
    const [scriptId, setScriptId] = useState(initialScriptId || '');
    const [selectedTargets, setSelectedTargets] = useState<{ agentId: string, deviceId: string | null }[]>([]);
    const [command, setCommand] = useState('npm test');
    const [isRunning, setIsRunning] = useState(false);
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedScripts, setSelectedScripts] = useState<SelectedScriptInstance[]>([]);

    // Fetch projects to read metadata
    useEffect(() => {
        if (isOpen) {
            fetch('/api/projects')
                .then(res => res.json())
                .then(data => setProjects(data))
                .catch(err => console.error('Failed to fetch projects', err));
        }
    }, [isOpen]);

    // Update parameters when scriptId changes and metadata is available
    useEffect(() => {
        if (isOpen && initialScriptId) {
            setScriptId(initialScriptId);
        }
    }, [isOpen, initialScriptId]);

    useEffect(() => {
        const project = projects.find(p => p.id === scriptId);
        if (project && project.metadata) {
            // Start with an empty sequence
            setSelectedScripts([]);
            toast.info(`Loaded scripts for ${project.metadata.name || 'project'}`);
        } else if (project) {
            setSelectedScripts([]);
        }
    }, [scriptId, projects]);

    // Build the combined command whenever selected scripts change
    useEffect(() => {
        const project = projects.find(p => p.id === scriptId);
        if (project && project.metadata?.scripts && selectedScripts.length > 0) {
            const combinedCommand = selectedScripts.map(instance => {
                const script = project.metadata!.scripts![instance.scriptIndex];
                let cmd = script.command;
                // Use instance parameters instead of script default parameters
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

    const handleRun = async () => {
        if (!scriptId) {
            toast.error('Please specify a script ID');
            return;
        }
        if (!command) {
            toast.error('Please add at least one script to the sequence');
            return;
        }
        if (selectedTargets.length === 0) {
            const msg = requiresDeviceTargets && requiresAgentTargets
                ? 'Please select at least one agent node and one mobile device'
                : requiresDeviceTargets
                    ? 'Please select at least one mobile device'
                    : 'Please select at least one agent node';
            toast.error(msg);
            return;
        }

        setIsRunning(true);

        const finalCommand = command.trim();

        try {
            const promises = selectedTargets.map(target =>
                fetch('/api/jobs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        scriptId,
                        agentId: target.agentId,
                        deviceId: target.deviceId, // if null, it will be omitted from the JSON or sent as null
                        command: finalCommand
                    }),
                }).then(res => res.json())
            );

            const results = await Promise.all(promises);
            const failures = results.filter(r => !r.success);

            if (failures.length === 0) {
                toast.success(`Job started across ${selectedTargets.length} target(s)`);
                onClose();
            } else {
                toast.error(`Failed on ${failures.length} target(s)`);
            }
        } catch (err) {
            console.error(err);
            toast.error('Failed to start jobs');
        } finally {
            setIsRunning(false);
        }
    };

    const toggleTarget = (agentId: string, deviceId: string | null) => {
        setSelectedTargets(prev => {
            const exists = prev.find(t => t.agentId === agentId && t.deviceId === deviceId);
            if (exists) {
                return prev.filter(t => !(t.agentId === agentId && t.deviceId === deviceId));
            } else {
                return [...prev, { agentId, deviceId }];
            }
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

    // Compute required targets based on the selected scripts in the sequence
    const requiresDeviceTargets = selectedScripts.some(instance => {
        const type = currentProject?.metadata?.scripts?.[instance.scriptIndex]?.type || 'mobile';
        return type === 'mobile';
    });

    const requiresAgentTargets = selectedScripts.some(instance => {
        const type = currentProject?.metadata?.scripts?.[instance.scriptIndex]?.type || 'mobile';
        return type === 'api' || type === 'browser';
    });

    // Cleanup invalid selected targets if requirements change
    useEffect(() => {
        setSelectedTargets(prev => prev.filter(t => {
            if (t.deviceId !== null && !requiresDeviceTargets) return false;
            if (t.deviceId === null && !requiresAgentTargets) return false;
            return true;
        }));
    }, [requiresDeviceTargets, requiresAgentTargets]);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto w-[95vw] p-4 sm:p-6">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Terminal className="w-5 h-5 text-blue-500" />
                        Run Automation Job
                    </DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <label htmlFor="scriptId" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 flex items-center gap-2">
                            <FileCode size={14} /> Script ID
                        </label>
                        <Input
                            id="scriptId"
                            value={scriptId}
                            onChange={(e) => setScriptId(e.target.value)}
                            placeholder="e.g. 1740000000000-script.zip"
                        />
                        <p className="text-[10px] text-slate-500">
                            Copy the Script ID from the uploaded file.
                        </p>
                    </div>
                    <div className="grid gap-2">
                        <label className="text-sm font-medium leading-none flex justify-between">
                            <span>Targets ({selectedTargets.length} selected)</span>
                            <Button
                                variant="link"
                                size="sm"
                                className="h-auto p-0 text-xs"
                                onClick={() => {
                                    const allTargets: { agentId: string, deviceId: string | null }[] = [];
                                    agents.filter(a => a.status === 'online').forEach(a => {
                                        if (requiresAgentTargets) {
                                            allTargets.push({ agentId: a.id, deviceId: null });
                                        }
                                        if (requiresDeviceTargets) {
                                            a.devices.forEach(d => {
                                                allTargets.push({ agentId: a.id, deviceId: d.id });
                                            });
                                        }
                                    });
                                    setSelectedTargets(allTargets.length === selectedTargets.length ? [] : allTargets);
                                }}
                            >
                                Select All
                            </Button>
                        </label>
                        <div className="border border-slate-200 rounded-md max-h-40 overflow-y-auto bg-slate-50/50 p-2 space-y-2">
                            {agents.filter(a => a.status === 'online').length === 0 && (
                                <p className="text-xs text-slate-500 text-center py-2">No online agents available.</p>
                            )}

                            {(!requiresAgentTargets && !requiresDeviceTargets) && selectedScripts.length > 0 && (
                                <p className="text-xs text-slate-500 text-center py-2 italic text-amber-600">
                                    Please add a script to the sequence to select targets.
                                </p>
                            )}

                            {selectedScripts.length === 0 && (
                                <div className="text-xs text-slate-500 text-center py-4 flex flex-col items-center gap-2">
                                    <Info className="w-4 h-4 text-blue-400" />
                                    <span>Add a script to the sequence below to enable target selection.</span>
                                </div>
                            )}
                            {selectedScripts.length > 0 && requiresDeviceTargets && !agents.some(a => a.status === 'online' && a.devices.length > 0) && (
                                <p className="text-xs text-amber-600 text-center py-2">No online agents with mobile devices available.</p>
                            )}
                            {selectedScripts.length > 0 && requiresAgentTargets && !agents.some(a => a.status === 'online') && (
                                <p className="text-xs text-amber-600 text-center py-2">No online agents available for API/Browser tests.</p>
                            )}
                            {selectedScripts.length > 0 && agents.filter(a => a.status === 'online').map(agent => {
                                // Agent-level checkbox (device-less)
                                const isAgentSelected = selectedTargets.some(t => t.agentId === agent.id && t.deviceId === null);

                                return (
                                    <div key={agent.id} className="space-y-1 mb-2 border-b border-slate-100 pb-2 last:border-0">
                                        <div className="flex items-center justify-between px-1 mb-1">
                                            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{agent.hostname}</div>
                                        </div>

                                        {/* Agent Environment Target */}
                                        {requiresAgentTargets && (
                                            <div
                                                className={`flex items-center gap-2 p-2 rounded-md cursor-pointer border text-sm transition-colors ${isAgentSelected ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-100 hover:border-slate-300'}`}
                                                onClick={() => toggleTarget(agent.id, null)}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isAgentSelected}
                                                    readOnly
                                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600 pointer-events-none"
                                                />
                                                <div className="flex-1 font-medium text-slate-700 flex items-center gap-2">
                                                    <span className="text-purple-600 font-bold text-[10px] bg-purple-50 px-1 py-0.5 rounded border border-purple-100">Agent VM</span>
                                                    Agent Environment (API / Browser)
                                                </div>
                                            </div>
                                        )}

                                        {/* Connected Devices */}
                                        {requiresDeviceTargets && agent.devices.map(device => {
                                            const isSelected = selectedTargets.some(t => t.agentId === agent.id && t.deviceId === device.id);
                                            return (
                                                <div
                                                    key={device.id}
                                                    className={`flex items-center gap-2 p-2 rounded-md cursor-pointer border text-sm transition-colors ${isSelected ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-100 hover:border-slate-300'}`}
                                                    onClick={() => toggleTarget(agent.id, device.id)}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        readOnly
                                                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600 pointer-events-none"
                                                    />
                                                    <div className="flex-1 font-medium text-slate-700 flex items-center gap-2">
                                                        {device.platform === 'ios' ? (
                                                            <span className="text-slate-400 font-bold text-[10px] bg-slate-100 px-1 py-0.5 rounded">iOS</span>
                                                        ) : (
                                                            <span className="text-emerald-600 font-bold text-[10px] bg-emerald-50 px-1 py-0.5 rounded border border-emerald-100">Android</span>
                                                        )}
                                                        {device.model} <span className="text-xs text-slate-400 font-mono">({device.id})</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="grid gap-2 border-t pt-4">
                        <label className="text-sm font-medium leading-none flex items-center justify-between">
                            <span>Build Execution Sequence</span>
                        </label>

                        <div className="flex flex-col gap-2">
                            {/* Available Scripts Pool */}
                            <div className="border border-slate-200 rounded-md bg-white p-2">
                                <div className="text-[10px] uppercase font-bold text-slate-400 mb-2 tracking-wider flex items-center gap-1">
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
                                                        className="text-xs h-7 bg-slate-50 border-dashed hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700"
                                                        onClick={() => addScriptToSequence(idx)}
                                                    >
                                                        <Plus size={12} className="mr-1" />
                                                        {script.name}
                                                    </Button>
                                                </TooltipTrigger>
                                                {script.description && (
                                                    <TooltipContent className="max-w-xs text-xs">
                                                        <p>{script.description}</p>
                                                    </TooltipContent>
                                                )}
                                            </Tooltip>
                                        </TooltipProvider>
                                    ))}
                                    {(!currentProject?.metadata?.scripts || currentProject.metadata.scripts.length === 0) && (
                                        <div className="text-xs italic text-slate-400 text-center py-2 w-full">
                                            No scripts found in project metadata.
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Current Sequence List */}
                            <div className="border border-slate-200 rounded-md bg-slate-50 p-2 min-h-[60px] max-h-[160px] overflow-y-auto">
                                <div className="text-[10px] uppercase font-bold text-slate-400 mb-2 tracking-wider flex justify-between">
                                    <span>Current Sequence</span>
                                </div>

                                {selectedScripts.length === 0 ? (
                                    <div className="text-xs italic text-slate-400 text-center py-2">
                                        Click an available script to add it to the sequence.
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        {selectedScripts.map((instance, sequenceIdx) => {
                                            const scriptIdx = instance.scriptIndex;
                                            const script = currentProject?.metadata?.scripts?.[scriptIdx];
                                            if (!script) return null;

                                            return (
                                                <div key={`${scriptIdx}-${sequenceIdx}`} className="flex flex-col bg-white border border-slate-200 rounded shadow-sm text-xs">
                                                    {/* Header: Sequence Number, Name, Actions */}
                                                    <div className="flex items-center justify-between p-1 border-b border-slate-100 bg-slate-50/50">
                                                        <div className="flex items-center gap-2 overflow-hidden">
                                                            <span className="bg-indigo-100 text-indigo-700 text-[10px] font-bold px-1.5 py-0.5 rounded-sm shrink-0">
                                                                {sequenceIdx + 1}
                                                            </span>
                                                            <span className="truncate font-medium text-slate-700">
                                                                {script.name}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center shrink-0">
                                                            <button
                                                                onClick={() => moveScript(sequenceIdx, 'up')}
                                                                disabled={sequenceIdx === 0}
                                                                className={`p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded ${sequenceIdx === 0 ? 'opacity-30 cursor-not-allowed' : ''}`}
                                                            >
                                                                ▲
                                                            </button>
                                                            <button
                                                                onClick={() => moveScript(sequenceIdx, 'down')}
                                                                disabled={sequenceIdx === selectedScripts.length - 1}
                                                                className={`p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded ${sequenceIdx === selectedScripts.length - 1 ? 'opacity-30 cursor-not-allowed' : ''}`}
                                                            >
                                                                ▼
                                                            </button>
                                                            <div className="w-px h-3 bg-slate-200 mx-1"></div>
                                                            <button
                                                                onClick={() => removeScriptFromSequence(sequenceIdx)}
                                                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded text-[10px]"
                                                            >
                                                                <X size={12} />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Script Specific Parameters */}
                                                    <div className="p-2 space-y-2 bg-white rounded-b">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider flex items-center gap-1">
                                                                <Variable size={10} /> Parameters
                                                            </span>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-5 text-[10px] px-1.5 py-0 text-indigo-600 hover:bg-indigo-50"
                                                                onClick={() => addInstanceParameter(sequenceIdx)}
                                                            >
                                                                <Plus size={10} className="mr-0.5" /> Add
                                                            </Button>
                                                        </div>

                                                        {instance.parameters.length === 0 ? (
                                                            <div className="text-[10px] text-slate-400 italic">No parameters</div>
                                                        ) : (
                                                            <div className="space-y-1.5">
                                                                <TooltipProvider delayDuration={300}>
                                                                    {instance.parameters.map((param, paramIdx) => (
                                                                        <div key={paramIdx} className="flex items-center gap-1.5">
                                                                            {param.description ? (
                                                                                <Tooltip>
                                                                                    <TooltipTrigger asChild>
                                                                                        <div className="relative flex-[0.8] group">
                                                                                            <Input
                                                                                                value={param.key}
                                                                                                onChange={(e) => updateInstanceParameter(sequenceIdx, paramIdx, 'key', e.target.value)}
                                                                                                placeholder="key"
                                                                                                className="h-6 text-[10px] pr-5"
                                                                                            />
                                                                                            <Info className="absolute right-1 top-1.5 h-3 w-3 text-blue-400 opacity-50 group-hover:opacity-100 transition-opacity" />
                                                                                        </div>
                                                                                    </TooltipTrigger>
                                                                                    <TooltipContent side="top" className="max-w-xs text-xs">
                                                                                        <p>{param.description}</p>
                                                                                    </TooltipContent>
                                                                                </Tooltip>
                                                                            ) : (
                                                                                <Input
                                                                                    value={param.key}
                                                                                    onChange={(e) => updateInstanceParameter(sequenceIdx, paramIdx, 'key', e.target.value)}
                                                                                    placeholder="key"
                                                                                    className="h-6 text-[10px] flex-[0.8]"
                                                                                />
                                                                            )}

                                                                            <span className="text-slate-400 text-xs">=</span>

                                                                            {param.options && param.options.length > 0 ? (
                                                                                <select
                                                                                    value={param.value}
                                                                                    onChange={(e) => updateInstanceParameter(sequenceIdx, paramIdx, 'value', e.target.value)}
                                                                                    className="flex h-6 flex-1 items-center justify-between rounded-md border border-slate-200 bg-white px-2 py-0 text-[10px] ring-offset-white focus:outline-none focus:ring-1 focus:ring-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
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
                                                                                    className="h-6 text-[10px] flex-1"
                                                                                />
                                                                            )}

                                                                            <button
                                                                                onClick={() => removeInstanceParameter(sequenceIdx, paramIdx)}
                                                                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded"
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
                        </div>
                    </div>

                    <div className="grid gap-2 border-t pt-4">
                        <label htmlFor="command" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            Generated Command
                        </label>
                        <Input
                            id="command"
                            value={command}
                            onChange={(e) => setCommand(e.target.value)}
                            placeholder="npm test"
                            readOnly={true}
                            className="bg-slate-50 cursor-not-allowed font-mono text-xs"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleRun} disabled={isRunning} className="bg-blue-600 hover:bg-blue-700">
                        {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                        Run Job
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
