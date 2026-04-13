import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TestCase, TestSuite } from '@qa/types';
import { Link as LinkIcon, Folder, AlertCircle, CheckCircle2, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface TestCaseViewDialogProps {
    isOpen: boolean;
    onClose: () => void;
    testCase: TestCase | null;
    suites: TestSuite[];
}

export function TestCaseViewDialog({ isOpen, onClose, testCase, suites }: TestCaseViewDialogProps) {
    if (!testCase) return null;

    const suiteName = testCase.suiteId 
        ? suites.find(s => s.id === testCase.suiteId)?.name || 'Unknown Suite'
        : 'Uncategorized';

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'active': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
            case 'draft': return 'bg-amber-50 text-amber-700 border-amber-200';
            case 'deprecated': return 'bg-slate-100 text-slate-600 border-slate-200';
            default: return 'bg-slate-50 text-slate-700 border-slate-200';
        }
    };
    
    const getPriorityStyle = (priority?: string) => {
        switch (priority) {
            case 'high': return 'bg-red-50 text-red-700 border-red-200';
            case 'medium': return 'bg-blue-50 text-blue-700 border-blue-200';
            case 'low': return 'bg-slate-50 text-slate-600 border-slate-200';
            default: return 'bg-slate-50 text-slate-600 border-slate-200';
        }
    };
    
    const getTypeStyle = (type?: string) => {
        switch (type) {
            case 'auto': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
            case 'manual': return 'bg-orange-50 text-orange-700 border-orange-200';
            default: return 'bg-slate-50 text-slate-600 border-slate-200';
        }
    };

    const copyToClipboard = () => {
        // Simple plaintext copy helper
        const text = `Test Case: ${testCase.title}\nSuite: ${suiteName}\nStatus: ${testCase.status}\n\nDescription:\n${testCase.description || 'N/A'}\n\nSteps:\n${Array.isArray(testCase.steps) ? testCase.steps.map((s, i) => `${i+1}. ${s.action} (Expected: ${s.expectedResult})`).join('\n') : 'N/A'}`;
        navigator.clipboard.writeText(text);
        toast.success("Copied details to clipboard");
    };

    const getSafeUrl = (url: string) => {
        // Fix common typos like https;//
        let safeUrl = url.trim().replace(/^https?;\/\//, 'https://');
        if (!/^https?:\/\//i.test(safeUrl)) {
            safeUrl = 'http://' + safeUrl;
        }
        return safeUrl;
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[800px] h-[90vh] flex flex-col p-0 gap-0 overflow-hidden bg-slate-50 border-slate-200 shadow-2xl">
                <DialogHeader className="px-6 py-4 bg-white border-b border-slate-200 shrink-0 flex flex-col gap-3">
                    <div className="flex items-start justify-between">
                        <DialogTitle className="text-2xl font-black flex flex-col gap-1 text-slate-900 leading-tight">
                            <span className="flex items-center gap-2">
                                {testCase.title}
                                <Badge variant="secondary" className="text-xs uppercase font-bold bg-slate-100 text-slate-500">
                                    v{testCase.version || 1}
                                </Badge>
                                {testCase.isDeleted && <Badge variant="destructive" className="text-xs font-bold">Deleted</Badge>}
                            </span>
                            <span className="text-sm font-medium text-slate-500 flex items-center gap-1.5 mt-1">
                                <Folder size={14} className="text-blue-500" />
                                {suiteName}
                            </span>
                        </DialogTitle>
                        <Button variant="ghost" size="sm" onClick={copyToClipboard} className="text-slate-400 hover:text-slate-800 gap-1.5 h-8">
                            <Copy size={14} /> Copy
                        </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Badge className={cn("px-2.5 py-0.5 rounded-full text-xs font-bold border capitalize", getStatusStyle(testCase.status))} variant="outline">{testCase.status}</Badge>
                        <Badge className={cn("px-2.5 py-0.5 rounded-full text-xs font-bold border capitalize", getPriorityStyle(testCase.priority))} variant="outline">{testCase.priority || 'Medium'} Prio</Badge>
                        <Badge className={cn("px-2.5 py-0.5 rounded-full text-xs font-bold border capitalize", getTypeStyle(testCase.type))} variant="outline">{testCase.type || 'Manual'}</Badge>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
                    
                    {/* Descriptions & Preconditions */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-3">
                            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                Description
                            </h3>
                            <div className="bg-white p-4 rounded-xl border border-slate-200 text-sm text-slate-700 min-h-[100px] whitespace-pre-wrap leading-relaxed shadow-sm">
                                {testCase.description || <span className="text-slate-400 italic">No description provided.</span>}
                            </div>
                        </div>
                        <div className="space-y-3">
                            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                <AlertCircle size={14} className="text-amber-500" />
                                Preconditions
                            </h3>
                            <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-100 text-sm text-slate-700 min-h-[100px] whitespace-pre-wrap leading-relaxed">
                                {testCase.preconditions || <span className="text-slate-400 italic">None.</span>}
                            </div>
                        </div>
                    </div>

                    {/* Test Steps */}
                    <div className="space-y-3">
                        <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                            Execution Steps
                        </h3>
                        <div className="space-y-3">
                            {!Array.isArray(testCase.steps) || testCase.steps.length === 0 ? (
                                <div className="text-sm text-slate-400 italic bg-white p-4 rounded-xl border border-slate-200">No steps defined.</div>
                            ) : (
                                testCase.steps.map((step, index) => (
                                    <div key={index} className="flex gap-4 items-stretch bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                        <div className="bg-slate-100 px-4 py-3 flex items-center justify-center font-black text-slate-400 border-r border-slate-200">
                                            {index + 1}
                                        </div>
                                        <div className="flex-1 py-3 px-2">
                                            <div className="text-sm font-semibold text-slate-800 mb-1">Action</div>
                                            <div className="text-sm text-slate-600 whitespace-pre-wrap">{step.action || '-'}</div>
                                        </div>
                                        <div className="flex-1 py-3 px-4 bg-blue-50/30 border-l border-slate-100">
                                            <div className="text-sm font-semibold text-blue-800 mb-1 flex items-center gap-1">
                                                <CheckCircle2 size={12} className="text-blue-500"/> Expected Result
                                            </div>
                                            <div className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{step.expectedResult || '-'}</div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Overall Expected Result */}
                    {testCase.expectedResult && (
                        <div className="space-y-3">
                            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                <CheckCircle2 size={16} className="text-emerald-500" />
                                Overall Expected Result
                            </h3>
                            <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-100 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                {testCase.expectedResult}
                            </div>
                        </div>
                    )}

                    {/* Links */}
                    {testCase.links && testCase.links.length > 0 && (
                        <div className="space-y-3">
                            <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                                <LinkIcon size={14} className="text-slate-400" />
                                Related Documents & Links
                            </h3>
                            <div className="flex flex-col gap-2">
                                {testCase.links.map((link, idx) => (
                                    <a key={idx} href={getSafeUrl(link)} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200 shadow-sm w-fit max-w-full">
                                        <LinkIcon size={12} />
                                        <span className="truncate">{link}</span>
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                    
                </div>
            </DialogContent>
        </Dialog>
    );
}
