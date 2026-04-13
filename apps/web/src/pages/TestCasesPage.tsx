import { useState, useEffect } from 'react';
import { Project, TestCase, TestSuite, TestCaseCreateInput } from '@qa/types';
import { FileText, Plus, Search, Trash2, Edit2, Link as LinkIcon, ExternalLink, Folder, FolderOpen, ChevronRight, ChevronDown, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { TestCaseDialog } from '../components/TestCaseDialog';
import { TestSuiteDialog } from '../components/TestSuiteDialog';
import { TestCaseViewDialog } from '../components/TestCaseViewDialog';

interface TestCasesPageProps {
    projects: Project[];
}

export function TestCasesPage({ projects }: TestCasesPageProps) {
    const [testCases, setTestCases] = useState<TestCase[]>([]);
    const [suites, setSuites] = useState<TestSuite[]>([]);
    
    // UI State
    const [searchTerm, setSearchTerm] = useState('');
    const [activeSuiteId, setActiveSuiteId] = useState<string | null>('UNCATEGORIZED');
    const [expandedSuites, setExpandedSuites] = useState<Set<string>>(new Set());
    const [isLoading, setIsLoading] = useState(true);

    // Dialogs State
    const [viewingTestCase, setViewingTestCase] = useState<TestCase | null>(null);
    const [isTestCaseDialogOpen, setIsTestCaseDialogOpen] = useState(false);
    const [editingTestCase, setEditingTestCase] = useState<TestCase | null>(null);

    const [isSuiteDialogOpen, setIsSuiteDialogOpen] = useState(false);
    const [editingSuite, setEditingSuite] = useState<TestSuite | null>(null);
    const [suiteParentForNew, setSuiteParentForNew] = useState<string | null>(null);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const [casesRes, suitesRes] = await Promise.all([
                fetch('/api/test-cases'),
                fetch('/api/test-suites')
            ]);
            
            if (casesRes.ok && suitesRes.ok) {
                const casesData = await casesRes.json();
                const suitesData = await suitesRes.json();
                setTestCases(casesData);
                setSuites(suitesData);
            } else {
                toast.error('Failed to load data');
            }
        } catch (error) {
            console.error(error);
            toast.error('Error fetching data');
        } finally {
            setIsLoading(false);
        }
    };

    // --- Suite Operations ---
    const handleSaveSuite = async (data: { name: string, description?: string, parentId?: string | null }) => {
        try {
            const url = editingSuite ? `/api/test-suites/${editingSuite.id}` : '/api/test-suites';
            const method = editingSuite ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                toast.success(editingSuite ? 'Suite updated' : 'Suite created');
                fetchData();
                setIsSuiteDialogOpen(false);
            } else {
                toast.error('Failed to save suite');
            }
        } catch (err) {
            toast.error('Error saving suite');
        }
    };

    const handleDeleteSuite = async (id: string, hard: boolean = false) => {
        const msg = hard 
            ? 'Are you sure you want to PERMANENTLY delete this suite and its contents? This cannot be undone.'
            : 'Move suite and its contents to trash?';
        if (!confirm(msg)) return;
        
        try {
            const url = hard ? `/api/test-suites/${id}/hard` : `/api/test-suites/${id}`;
            const response = await fetch(url, { method: 'DELETE' });
            if (response.ok) {
                toast.success(hard ? 'Suite permanently deleted' : 'Suite moved to trash');
                if (activeSuiteId === id && !hard) setActiveSuiteId('TRASH');
                fetchData();
            } else {
                toast.error('Action failed');
            }
        } catch (error) {
            toast.error('Error operating on suite');
        }
    };

    const handleRestoreSuite = async (id: string) => {
        try {
            const response = await fetch(`/api/test-suites/${id}/restore`, { method: 'POST' });
            if (response.ok) {
                toast.success('Suite restored');
                fetchData();
            } else {
                toast.error('Failed to restore');
            }
        } catch (error) {
            toast.error('Error restoring suite');
        }
    };

    // --- TestCase Operations ---
    const handleSaveTestCase = async (data: TestCaseCreateInput) => {
        try {
            const url = editingTestCase ? `/api/test-cases/${editingTestCase.id}` : '/api/test-cases';
            const method = editingTestCase ? 'PUT' : 'POST';

            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            if (response.ok) {
                const saved = await response.json();
                toast.success(editingTestCase ? 'Test case updated' : 'Test case created');
                fetchData();
                setIsTestCaseDialogOpen(false);
                setActiveSuiteId(saved.suiteId || 'UNCATEGORIZED');
            } else {
                toast.error('Failed to save test case');
            }
        } catch (error) {
            toast.error('Error saving test case');
        }
    };

    const handleDeleteTestCase = async (id: string, hard: boolean = false) => {
        const msg = hard 
            ? 'Are you sure you want to PERMANENTLY delete this testcase? This cannot be undone.'
            : 'Move testcase to trash?';
        if (!confirm(msg)) return;

        try {
            const url = hard ? `/api/test-cases/${id}/hard` : `/api/test-cases/${id}`;
            const response = await fetch(url, { method: 'DELETE' });
            if (response.ok) {
                toast.success(hard ? 'Test case permanently deleted' : 'Test case moved to trash');
                fetchData();
            }
        } catch (error) {
            toast.error('Error operating on test case');
        }
    };

    const handleRestoreTestCase = async (id: string) => {
        try {
            const response = await fetch(`/api/test-cases/${id}/restore`, { method: 'POST' });
            if (response.ok) {
                toast.success('Test case restored');
                fetchData();
            } else {
                toast.error('Failed to restore');
            }
        } catch (error) {
            toast.error('Error restoring test case');
        }
    };

    const toggleSuiteExpansion = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const next = new Set(expandedSuites);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedSuites(next);
    };

    // --- Renderers ---
    const activeSuites = suites.filter(s => !s.isDeleted);
    
    const renderSuiteTree = (parentId: string | null = null, depth: number = 0) => {
        const children = activeSuites.filter(s => s.parentId === parentId || (parentId === null && !s.parentId));
        
        return children.map(suite => {
            const hasChildren = activeSuites.some(s => s.parentId === suite.id);
            const isExpanded = expandedSuites.has(suite.id);
            const isActive = activeSuiteId === suite.id;

            return (
                <div key={suite.id}>
                    <div 
                        className={cn(
                            "group flex items-center justify-between py-1.5 px-2 rounded-lg cursor-pointer transition-colors text-sm font-medium",
                            isActive ? "bg-blue-100/50 text-blue-700" : "text-slate-600 hover:bg-slate-100/50",
                            depth > 0 && "ml-4 border-l border-slate-200"
                        )}
                        style={{ paddingLeft: depth === 0 ? '0.5rem' : '1rem' }}
                        onClick={() => setActiveSuiteId(suite.id)}
                    >
                        <div className="flex items-center gap-1.5 truncate">
                            <button 
                                className="w-5 h-5 flex items-center justify-center shrink-0 text-slate-400 hover:text-slate-600"
                                onClick={(e) => hasChildren ? toggleSuiteExpansion(suite.id, e) : e.stopPropagation()}
                            >
                                {hasChildren ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="w-[14px]"></span>}
                            </button>
                            {isExpanded ? <FolderOpen size={16} className="text-blue-500 shrink-0" /> : <Folder size={16} className={isActive ? "text-blue-500" : "text-slate-400"} shrink-0 />}
                            <span className="truncate">{suite.name}</span>
                        </div>
                        
                        <div className="opacity-0 group-hover:opacity-100 flex items-center shrink-0 ml-2">
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-blue-600" onClick={(e) => { e.stopPropagation(); setSuiteParentForNew(suite.id); setEditingSuite(null); setIsSuiteDialogOpen(true); }} title="Add sub-suite">
                                <Plus size={14} />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-blue-600" onClick={(e) => { e.stopPropagation(); setEditingSuite(suite); setIsSuiteDialogOpen(true); }} title="Edit suite">
                                <Edit2 size={12} />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-red-500" onClick={(e) => { e.stopPropagation(); handleDeleteSuite(suite.id, false); }} title="Move to trash">
                                <Trash2 size={12} />
                            </Button>
                        </div>
                    </div>
                    {isExpanded && hasChildren && (
                        <div className="mt-1">
                            {renderSuiteTree(suite.id, depth + 1)}
                        </div>
                    )}
                </div>
            );
        });
    };

    const activeSuite = suites.find(s => s.id === activeSuiteId);
    
    // Derived states for different views
    const isTrashView = activeSuiteId === 'TRASH';
    const isUncategorizedView = activeSuiteId === 'UNCATEGORIZED';

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'active': return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
            case 'draft': return 'bg-amber-50 text-amber-700 ring-amber-200';
            case 'deprecated': return 'bg-slate-100 text-slate-600 ring-slate-200';
            default: return 'bg-slate-50 text-slate-700 ring-slate-200';
        }
    };
    const getPriorityStyle = (priority?: string) => {
        switch (priority) {
            case 'high': return 'bg-red-50 text-red-700 ring-red-200';
            case 'medium': return 'bg-blue-50 text-blue-700 ring-blue-200';
            case 'low': return 'bg-slate-50 text-slate-600 ring-slate-200';
            default: return 'bg-slate-50 text-slate-600 ring-slate-200';
        }
    };
    const getTypeStyle = (type?: string) => {
        switch (type) {
            case 'auto': return 'bg-indigo-50 text-indigo-700 ring-indigo-200';
            case 'manual': return 'bg-orange-50 text-orange-700 ring-orange-200';
            default: return 'bg-slate-50 text-slate-600 ring-slate-200';
        }
    };

    if (isLoading) {
        return <div className="p-20 text-center font-bold text-slate-400">Loading Test Management Interface...</div>;
    }

    return (
        <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 h-[calc(100vh-64px)] flex gap-6">
            
            {/* Left Sidebar: Test Suites Tree */}
            <div className="w-80 shrink-0 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col gap-3 shrink-0">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-slate-800 font-black">
                            <FolderOpen size={18} className="text-blue-600" />
                            Test Suites
                        </div>
                        <Button
                            variant="outline"
                            size="icon"
                            className="w-7 h-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            onClick={() => {
                                setEditingSuite(null);
                                setSuiteParentForNew(null);
                                setIsSuiteDialogOpen(true);
                            }}
                            title="Add Root Suite"
                        >
                            <Plus size={16} />
                        </Button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 flex flex-col">
                    <div 
                        className={cn(
                            "group flex items-center justify-between py-2 px-3 rounded-lg cursor-pointer transition-colors text-sm font-bold tracking-tight mb-2",
                            isUncategorizedView ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100/50"
                        )}
                        onClick={() => setActiveSuiteId('UNCATEGORIZED')}
                    >
                        <div className="flex items-center gap-2 truncate">
                            <Folder size={16} className={isUncategorizedView ? "text-slate-200" : "text-slate-400"} shrink-0 />
                            <span className="truncate">Uncategorized</span>
                        </div>
                        <Badge className="bg-slate-200/20 text-current hover:bg-slate-200/20 pointer-events-none">
                            {testCases.filter(tc => !tc.suiteId && !tc.isDeleted).length}
                        </Badge>
                    </div>

                    <div className="h-px bg-slate-100 my-2" />

                    <div className="flex-1">
                        {renderSuiteTree(null, 0)}
                    </div>

                    <div className="h-px bg-slate-100 my-2" />
                    
                    <div 
                        className={cn(
                            "group flex items-center justify-between py-2 px-3 rounded-lg cursor-pointer transition-colors text-sm font-bold tracking-tight",
                            isTrashView ? "bg-red-50 text-red-700" : "text-slate-600 hover:bg-red-50 hover:text-red-700"
                        )}
                        onClick={() => setActiveSuiteId('TRASH')}
                    >
                        <div className="flex items-center gap-2 truncate">
                            <Trash2 size={16} className={isTrashView ? "text-red-500" : "text-slate-400 group-hover:text-red-500"} shrink-0 />
                            <span className="truncate">Trash</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Main Area: Test Cases List or Trash */}
            <div className="flex-1 flex flex-col min-w-0 bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                {isTrashView ? (
                    // --- TRASH VIEW ---
                    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/30">
                        <div className="p-6 border-b border-red-100 bg-red-50/50 shrink-0">
                            <div className="flex items-center gap-2">
                                <Trash2 className="text-red-500" size={24} />
                                <h2 className="text-2xl font-black text-slate-900 tracking-tight">Trash Bin</h2>
                            </div>
                            <p className="text-slate-500 font-medium text-sm mt-1">Deleted items will stay here until permanently removed.</p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 space-y-8">
                            {/* Deleted Suites Section */}
                            <div>
                                <h3 className="text-lg font-bold text-slate-800 border-b border-slate-200 pb-2 mb-4">Deleted Suites</h3>
                                {suites.filter(s => s.isDeleted).length === 0 ? (
                                    <div className="text-slate-400 text-sm font-medium">No deleted suites.</div>
                                ) : (
                                    <div className="grid gap-3">
                                        {suites.filter(s => s.isDeleted).map(s => (
                                            <div key={s.id} className="flex items-center justify-between bg-white border border-slate-200 p-3 rounded-lg shadow-sm group">
                                                <div className="flex items-center gap-3">
                                                    <Folder className="text-red-400" size={18} />
                                                    <div>
                                                        <div className="font-bold text-slate-700 text-sm">{s.name}</div>
                                                        <div className="text-xs text-slate-400">Deleted: {new Date(s.deletedAt || 0).toLocaleString()}</div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Button variant="outline" size="sm" onClick={() => handleRestoreSuite(s.id)} className="h-8 text-blue-600 hover:text-blue-700 font-bold border-blue-200 hover:bg-blue-50">
                                                        <RefreshCw size={14} className="mr-1.5" /> Restore
                                                    </Button>
                                                    <Button variant="ghost" size="icon" onClick={() => handleDeleteSuite(s.id, true)} className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50">
                                                        <Trash2 size={16} />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Deleted Cases Section */}
                            <div>
                                <h3 className="text-lg font-bold text-slate-800 border-b border-slate-200 pb-2 mb-4">Deleted Test Cases</h3>
                                {testCases.filter(tc => tc.isDeleted).length === 0 ? (
                                    <div className="text-slate-400 text-sm font-medium">No deleted test cases.</div>
                                ) : (
                                    <div className="grid gap-3">
                                        {testCases.filter(tc => tc.isDeleted).map(tc => (
                                            <div key={tc.id} className="flex items-center justify-between bg-white border border-slate-200 p-3 rounded-lg shadow-sm group">
                                                <div className="flex items-center gap-3">
                                                    <FileText className="text-red-400" size={18} />
                                                    <div>
                                                        <div className="font-bold text-slate-700 text-sm">{tc.title}</div>
                                                        <div className="text-xs text-slate-400 flex items-center gap-2">
                                                            <span>Deleted: {new Date(tc.deletedAt || 0).toLocaleString()}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Button variant="outline" size="sm" onClick={() => handleRestoreTestCase(tc.id)} className="h-8 text-blue-600 hover:text-blue-700 font-bold border-blue-200 hover:bg-blue-50">
                                                        <RefreshCw size={14} className="mr-1.5" /> Restore
                                                    </Button>
                                                    <Button variant="ghost" size="icon" onClick={() => handleDeleteTestCase(tc.id, true)} className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50">
                                                        <Trash2 size={16} />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    // --- NORMAL VIEW ---
                    <>
                        <div className="p-6 border-b border-slate-200 bg-slate-50/50 shrink-0">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div>
                                    <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                                        {isUncategorizedView ? 'Uncategorized Cases' : activeSuite?.name}
                                    </h2>
                                    {activeSuite?.description && (
                                        <p className="text-slate-500 font-medium text-sm mt-1">{activeSuite.description}</p>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 w-full md:w-auto">
                                    <div className="relative w-full md:w-64">
                                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            type="text"
                                            className="block w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            placeholder="Search..."
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                        />
                                    </div>
                                    <Button
                                        onClick={() => {
                                            setEditingTestCase(null);
                                            setIsTestCaseDialogOpen(true);
                                        }}
                                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold gap-2 shrink-0 shadow-md shadow-blue-200/50"
                                    >
                                        <Plus size={16} strokeWidth={3} />
                                        Add Test Case
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto">
                            {(() => {
                                const list = testCases.filter(tc => {
                                    if (tc.isDeleted) return false;
                                    if (isUncategorizedView) {
                                        if (tc.suiteId) return false;
                                    } else {
                                        if (tc.suiteId !== activeSuiteId) return false;
                                    }
                                    if (!searchTerm) return true;
                                    return tc.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                           (tc.description && tc.description.toLowerCase().includes(searchTerm.toLowerCase()));
                                });

                                if (list.length === 0) {
                                    return (
                                        <div className="py-32 flex flex-col items-center justify-center text-center">
                                            <div className="bg-slate-50 p-4 rounded-full mb-4">
                                                <FileText size={32} className="text-slate-300" strokeWidth={2} />
                                            </div>
                                            <h3 className="text-lg font-bold text-slate-800">No test cases found</h3>
                                            <p className="text-slate-500 text-sm mt-1 max-w-sm">
                                                {searchTerm ? "No matches found." : "This category is empty. Add a test case."}
                                            </p>
                                        </div>
                                    );
                                }

                                return (
                                    <table className="w-full text-left text-sm text-slate-600">
                                        <thead className="text-xs uppercase bg-white sticky top-0 text-slate-500 font-bold border-b border-slate-200 z-10">
                                            <tr>
                                                <th className="px-6 py-4 w-5/12">Overview</th>
                                                <th className="px-6 py-4">Status & Details</th>
                                                <th className="px-6 py-4 text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {list.map(tc => (
                                                <tr key={tc.id} className="hover:bg-slate-50/80 transition-colors group">
                                                    <td className="px-6 py-5">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <div className="font-bold text-slate-900 text-base">{tc.title}</div>
                                                            <Badge variant="secondary" className="text-[10px] uppercase font-bold bg-slate-100 text-slate-500">v{tc.version || 1}</Badge>
                                                        </div>
                                                        <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mt-3">
                                                            {tc.history && tc.history.length > 0 ? (
                                                                <span title={tc.history[tc.history.length - 1].changes}>
                                                                    Updated {new Date(tc.updatedAt).toLocaleDateString()} &middot; {tc.history[tc.history.length - 1].changes || 'No message'}
                                                                </span>
                                                            ) : (
                                                                <span>Updated {new Date(tc.updatedAt).toLocaleDateString()}</span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-5 align-top">
                                                        <div className="flex flex-wrap gap-2">
                                                            <Badge className={cn("px-2.5 py-0.5 rounded-full text-xs font-bold ring-1 capitalize", getStatusStyle(tc.status))} variant="outline">{tc.status}</Badge>
                                                            <Badge className={cn("px-2.5 py-0.5 rounded-full text-xs font-bold ring-1 capitalize", getPriorityStyle(tc.priority))} variant="outline">{tc.priority || 'Medium'} Prio</Badge>
                                                            <Badge className={cn("px-2.5 py-0.5 rounded-full text-xs font-bold ring-1 capitalize", getTypeStyle(tc.type))} variant="outline">{tc.type || 'Manual'}</Badge>
                                                        </div>
                                                        <div className="mt-3 text-xs text-slate-500 font-medium">
                                                            {Array.isArray(tc.steps) ? `${tc.steps.length} steps defined` : 'Legacy string logic'}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-5 align-top text-right">
                                                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <Button variant="ghost" size="sm" onClick={() => setViewingTestCase(tc)} className="text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 font-bold h-8">
                                                                <FileText size={14} className="mr-1.5" /> View
                                                            </Button>
                                                            <Button variant="ghost" size="sm" onClick={() => { setEditingTestCase(tc); setIsTestCaseDialogOpen(true); }} className="text-slate-500 hover:text-blue-600 hover:bg-blue-50 font-bold h-8">
                                                                <Edit2 size={14} className="mr-1.5" /> Edit
                                                            </Button>
                                                            <Button variant="ghost" size="sm" onClick={() => handleDeleteTestCase(tc.id, false)} className="text-slate-400 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0" title="Move to trash">
                                                                <Trash2 size={16} />
                                                            </Button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                );
                            })()}
                        </div>
                    </>
                )}
            </div>

            <TestCaseDialog
                isOpen={isTestCaseDialogOpen}
                onClose={() => { setIsTestCaseDialogOpen(false); setEditingTestCase(null); }}
                onSave={handleSaveTestCase}
                initialData={editingTestCase}
                suites={suites}
                defaultSuiteId={isUncategorizedView || isTrashView ? undefined : activeSuiteId || undefined}
            />

            <TestSuiteDialog
                isOpen={isSuiteDialogOpen}
                onClose={() => { setIsSuiteDialogOpen(false); setEditingSuite(null); setSuiteParentForNew(null); }}
                onSave={handleSaveSuite}
                initialData={editingSuite}
                initialParentId={suiteParentForNew}
            />

            <TestCaseViewDialog
                isOpen={!!viewingTestCase}
                onClose={() => setViewingTestCase(null)}
                testCase={viewingTestCase}
                suites={suites}
            />
        </main>
    );
}
