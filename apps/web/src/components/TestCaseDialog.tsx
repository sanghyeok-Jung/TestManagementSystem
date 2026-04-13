import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TestCase, TestCaseCreateInput, TestCaseStep, TestSuite } from '@qa/types';
import { Plus, Trash2, Link as LinkIcon, Folder } from 'lucide-react';

interface TestCaseDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: any) => void;
    initialData?: TestCase | null;
    suites: TestSuite[];
    defaultSuiteId?: string;
}

export function TestCaseDialog({ isOpen, onClose, onSave, initialData, suites, defaultSuiteId }: TestCaseDialogProps) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [preconditions, setPreconditions] = useState('');
    const [expectedResult, setExpectedResult] = useState('');
    const [status, setStatus] = useState<'draft' | 'active' | 'deprecated'>('active');
    const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium');
    const [type, setType] = useState<'auto' | 'manual'>('manual');
    const [links, setLinks] = useState<string[]>([]);
    const [suiteId, setSuiteId] = useState<string>('');
    
    // New fields
    const [steps, setSteps] = useState<TestCaseStep[]>([]);
    const [changeReason, setChangeReason] = useState('');

    useEffect(() => {
        if (isOpen) {
            setTitle(initialData?.title || '');
            setDescription(initialData?.description || '');
            setPreconditions(initialData?.preconditions || '');
            setExpectedResult(initialData?.expectedResult || '');
            setStatus(initialData?.status || 'active');
            setPriority(initialData?.priority || 'medium');
            setType(initialData?.type || 'manual');
            setLinks(initialData?.links || []);
            setSuiteId(initialData?.suiteId || defaultSuiteId || (suites[0]?.id || ''));
            setChangeReason('');
            
            if (initialData?.steps && Array.isArray(initialData.steps)) {
                setSteps(initialData.steps);
            } else if (typeof initialData?.steps === 'string') {
                // Fallback for old string data: attempt to split by newline or keep as 1 step
                const strSteps = (initialData.steps as unknown as string).split('\n').filter(s => s.trim());
                setSteps(strSteps.map(s => ({ action: s, expectedResult: '' })));
            } else {
                setSteps([]);
            }
        }
    }, [isOpen, initialData]);

    const handleSave = () => {
        if (!title.trim()) return;

        onSave({
            suiteId: suiteId || null,
            title,
            description,
            preconditions,
            steps,
            expectedResult,
            status,
            priority,
            type,
            links: links.filter(l => l.trim() !== ''),
            changeReason: initialData ? changeReason : undefined
        });
    };

    const addLink = () => setLinks([...links, '']);
    const updateLink = (index: number, value: string) => {
        const newLinks = [...links];
        newLinks[index] = value;
        setLinks(newLinks);
    };
    const removeLink = (index: number) => {
        const newLinks = [...links];
        newLinks.splice(index, 1);
        setLinks(newLinks);
    };

    const addStep = () => setSteps([...steps, { action: '', expectedResult: '' }]);
    const updateStep = (index: number, field: 'action' | 'expectedResult', value: string) => {
        const newSteps = [...steps];
        newSteps[index][field] = value;
        setSteps(newSteps);
    };
    const removeStep = (index: number) => {
        const newSteps = [...steps];
        newSteps.splice(index, 1);
        setSteps(newSteps);
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[800px] h-[90vh] flex flex-col p-0 gap-0 overflow-hidden bg-slate-50 border-slate-200 shadow-2xl">
                <DialogHeader className="px-6 py-4 bg-white border-b border-slate-200 shrink-0 flex flex-row items-center justify-between">
                    <DialogTitle className="text-xl font-bold flex items-center gap-2 text-slate-800">
                        {initialData ? `Edit Test Case (v${initialData.version || 1})` : 'Create New Test Case'}
                    </DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto p-6 space-y-8">
                    <div className="grid gap-2 border-b border-slate-200 pb-6 mb-2">
                        <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                            <Folder size={14} className="text-blue-500" />
                            Target Test Suite
                        </label>
                        <select 
                            className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 font-medium"
                            value={suiteId}
                            onChange={(e) => setSuiteId(e.target.value)}
                        >
                            <option value="">None / Uncategorized</option>
                            {suites.filter(s => !s.isDeleted).map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                        </select>
                    </div>

                    {initialData && (
                        <div className="p-4 bg-blue-50/50 rounded-lg border border-blue-100 grid gap-2">
                            <label className="text-sm font-bold text-blue-800">Version Update Note (Optional)</label>
                            <input
                                type="text"
                                className="flex h-10 w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm placeholder:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm"
                                placeholder="E.g., Updated login steps for SSO"
                                value={changeReason}
                                onChange={e => setChangeReason(e.target.value)}
                            />
                        </div>
                    )}

                    <div className="space-y-4">
                        <div className="grid gap-2">
                            <label className="text-sm font-bold text-slate-700">Title <span className="text-red-500">*</span></label>
                            <input type="text" className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={title} onChange={e => setTitle(e.target.value)} />
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            <div className="grid gap-2">
                                <label className="text-sm font-bold text-slate-700">Status</label>
                                <select className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={status} onChange={e => setStatus(e.target.value as any)}>
                                    <option value="draft">Draft</option>
                                    <option value="active">Active</option>
                                    <option value="deprecated">Deprecated</option>
                                </select>
                            </div>
                            <div className="grid gap-2">
                                <label className="text-sm font-bold text-slate-700">Priority</label>
                                <select className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={priority} onChange={e => setPriority(e.target.value as any)}>
                                    <option value="high">High</option>
                                    <option value="medium">Medium</option>
                                    <option value="low">Low</option>
                                </select>
                            </div>
                            <div className="grid gap-2">
                                <label className="text-sm font-bold text-slate-700">Type</label>
                                <select className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={type} onChange={e => setType(e.target.value as any)}>
                                    <option value="auto">Auto</option>
                                    <option value="manual">Manual</option>
                                </select>
                            </div>
                        </div>

                        <div className="grid gap-2">
                            <label className="text-sm font-bold text-slate-700">Description</label>
                            <textarea className="flex min-h-[60px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" value={description} onChange={e => setDescription(e.target.value)} />
                        </div>

                        <div className="grid gap-2">
                            <label className="text-sm font-bold text-slate-700">Preconditions</label>
                            <textarea className="flex min-h-[60px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" value={preconditions} onChange={e => setPreconditions(e.target.value)} />
                        </div>

                        <div className="grid gap-4 mt-6">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                    Test Steps
                                </label>
                                <Button type="button" variant="ghost" size="sm" onClick={addStep} className="h-7 text-xs font-bold text-blue-600 hover:bg-blue-50">
                                    <Plus size={14} className="mr-1" /> Add Step
                                </Button>
                            </div>
                            
                            <div className="space-y-3">
                                {steps.length === 0 && <div className="text-sm text-slate-400 italic">No steps added.</div>}
                                {steps.map((step, index) => (
                                    <div key={index} className="flex gap-3 group items-start bg-slate-50 p-3 rounded-lg border border-slate-200">
                                        <div className="font-bold text-slate-400 mt-2 min-w-[20px]">{index + 1}.</div>
                                        <div className="flex-1 space-y-2">
                                            <textarea 
                                                className="flex min-h-[40px] w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" 
                                                placeholder="Action..." 
                                                value={step.action} 
                                                onChange={e => updateStep(index, 'action', e.target.value)} 
                                            />
                                            <textarea 
                                                className="flex min-h-[40px] w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm resize-none bg-blue-50/50 focus:outline-none focus:ring-2 focus:ring-blue-500" 
                                                placeholder="Expected Result for this step..." 
                                                value={step.expectedResult} 
                                                onChange={e => updateStep(index, 'expectedResult', e.target.value)} 
                                            />
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => removeStep(index)}
                                            className="text-slate-400 hover:text-red-600 hover:bg-red-50"
                                        >
                                            <Trash2 size={16} />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="grid gap-2 border-t border-slate-200 pt-6 mt-6">
                            <label className="text-sm font-bold text-slate-700">Overall Expected Result</label>
                            <textarea className="flex min-h-[60px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" value={expectedResult} onChange={e => setExpectedResult(e.target.value)} />
                        </div>

                        <div className="grid gap-2">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                    <LinkIcon size={14} className="text-slate-400"/>
                                    Related Links
                                </label>
                                <Button type="button" variant="ghost" size="sm" onClick={addLink} className="h-7 text-xs font-bold text-blue-600 hover:bg-blue-50">
                                    <Plus size={14} className="mr-1" /> Add Link
                                </Button>
                            </div>
                            <div className="space-y-2">
                                {links.map((link, index) => (
                                    <div key={index} className="flex items-center gap-2 group">
                                        <input type="url" className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm" value={link} onChange={e => updateLink(index, e.target.value)} />
                                        <Button type="button" variant="ghost" size="icon" onClick={() => removeLink(index)} className="h-9 w-9 text-slate-400 hover:text-red-600 hover:bg-red-50">
                                            <Trash2 size={16} />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter className="px-6 py-4 bg-white border-t border-slate-200 shrink-0">
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSave} className="bg-blue-600 text-white hover:bg-blue-700" disabled={!title.trim()}>
                        {initialData ? 'Update Test Case' : 'Create Test Case'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
