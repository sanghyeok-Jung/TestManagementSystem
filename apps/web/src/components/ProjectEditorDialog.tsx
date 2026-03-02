import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Project } from '@qa/types';
import Editor from '@monaco-editor/react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileCode2, Folder, File as FileIcon, Save, Trash2, Plus, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

interface ProjectEditorDialogProps {
    isOpen: boolean;
    onClose: () => void;
    project: Project;
}

interface FileNode {
    name: string;
    path: string;
    type: 'file' | 'directory';
    children?: FileNode[];
}

export const ProjectEditorDialog: React.FC<ProjectEditorDialogProps> = ({ isOpen, onClose, project }) => {
    const [files, setFiles] = useState<FileNode[]>([]);
    const [loadingFiles, setLoadingFiles] = useState(false);

    const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
    const [fileContent, setFileContent] = useState<string>('');
    const [originalContent, setOriginalContent] = useState<string>('');

    const [loadingContent, setLoadingContent] = useState(false);
    const [saving, setSaving] = useState(false);

    const [newFileName, setNewFileName] = useState('');
    const [isCreatingFile, setIsCreatingFile] = useState(false);

    const isDirty = fileContent !== originalContent;

    const fetchFiles = async () => {
        setLoadingFiles(true);
        try {
            const res = await axios.get<{ files: FileNode[] }>(`/api/projects/${project.id}/files`);
            setFiles(res.data.files);
        } catch (error) {
            console.error('Failed to load files:', error);
            toast.error('Failed to load project files');
        } finally {
            setLoadingFiles(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchFiles();
        } else {
            // Reset state on close
            setSelectedFilePath(null);
            setFileContent('');
            setOriginalContent('');
            setNewFileName('');
            setIsCreatingFile(false);
        }
    }, [isOpen, project.id]);

    const handleSelectFile = async (path: string) => {
        if (isDirty && !window.confirm('You have unsaved changes. Discard?')) {
            return;
        }

        setSelectedFilePath(path);
        setLoadingContent(true);
        setIsCreatingFile(false);

        try {
            const res = await axios.get<{ content: string }>(`/api/projects/${project.id}/files/content?file=${encodeURIComponent(path)}`);
            setFileContent(res.data.content);
            setOriginalContent(res.data.content);
        } catch (error: any) {
            console.error('Failed to load file content:', error);
            if (error.response?.status === 404) {
                toast.error('File not found or cannot be read (might be a binary file)');
            } else {
                toast.error('Failed to load file content');
            }
            setSelectedFilePath(null);
        } finally {
            setLoadingContent(false);
        }
    };

    const handleSave = async () => {
        if (!selectedFilePath) return;

        setSaving(true);
        try {
            await axios.put(`/api/projects/${project.id}/files/content`, {
                file: selectedFilePath,
                content: fileContent
            });
            setOriginalContent(fileContent);
            toast.success('File saved completely');
            fetchFiles(); // Refresh tree (in case it was a new file being saved)
        } catch (error) {
            console.error('Failed to save file:', error);
            toast.error('Failed to save file');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (path: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm(`Delete ${path}? This action cannot be undone.`)) return;

        try {
            await axios.delete(`/api/projects/${project.id}/files/content?file=${encodeURIComponent(path)}`);
            toast.success('File deleted');
            if (selectedFilePath === path) {
                setSelectedFilePath(null);
                setFileContent('');
                setOriginalContent('');
            }
            fetchFiles();
        } catch (error) {
            console.error('Failed to delete file:', error);
            toast.error('Failed to delete file');
        }
    };

    const handleCreateFile = () => {
        if (!newFileName.trim()) return;

        setSelectedFilePath(newFileName);
        setFileContent('// New file\n');
        setOriginalContent('');
        setIsCreatingFile(false);
        setNewFileName('');
    };

    const renderTree = (nodes: FileNode[], depth = 0) => {
        return nodes.map(node => (
            <div key={node.path}>
                <div
                    className={`group flex items-center justify-between py-1.5 px-2 text-sm rounded-md cursor-pointer transition-colors ${selectedFilePath === node.path
                        ? 'bg-indigo-50 text-indigo-700 font-medium'
                        : 'text-slate-600 hover:bg-slate-100'
                        }`}
                    style={{ paddingLeft: `${(depth * 12) + 8}px` }}
                    onClick={() => node.type === 'file' ? handleSelectFile(node.path) : null}
                >
                    <div className="flex items-center gap-2 truncate">
                        {node.type === 'directory' ? (
                            <Folder size={14} className="text-slate-400" />
                        ) : (
                            <FileIcon size={14} className={selectedFilePath === node.path ? "text-indigo-500" : "text-slate-400"} />
                        )}
                        <span className="truncate">{node.name}</span>
                    </div>
                    {node.type === 'file' && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 hover:text-rose-600"
                            onClick={(e) => handleDelete(node.path, e)}
                        >
                            <Trash2 size={12} />
                        </Button>
                    )}
                </div>
                {node.type === 'directory' && node.children && (
                    <div className="group">
                        {renderTree(node.children, depth + 1)}
                    </div>
                )}
            </div>
        ));
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => {
            if (!open) {
                if (isDirty && !window.confirm('You have unsaved changes. Close anyway?')) return;
                onClose();
            }
        }}>
            <DialogContent className="max-w-6xl h-[85vh] p-0 flex flex-col overflow-hidden bg-slate-50">
                <DialogHeader className="px-6 py-4 border-b border-slate-200 bg-white">
                    <DialogTitle className="flex items-center gap-2">
                        <FileCode2 className="text-indigo-600 w-5 h-5" />
                        {project.name} - Code Editor
                    </DialogTitle>
                </DialogHeader>

                <div className="flex flex-1 overflow-hidden">
                    {/* Sidebar File Tree */}
                    <div className="w-64 border-r border-slate-200 bg-white flex flex-col">
                        <div className="p-3 border-b border-slate-100 flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Files</span>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-indigo-600 hover:bg-indigo-50"
                                onClick={() => setIsCreatingFile(true)}
                            >
                                <Plus size={14} className="mr-1" /> New
                            </Button>
                        </div>

                        {isCreatingFile && (
                            <div className="p-2 border-b border-slate-100 flex items-center gap-2 bg-indigo-50/50">
                                <Input
                                    className="h-7 text-xs"
                                    placeholder="filename.ext"
                                    value={newFileName}
                                    onChange={e => setNewFileName(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleCreateFile()}
                                    autoFocus
                                />
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-rose-500" onClick={() => setIsCreatingFile(false)}>
                                    <X size={14} />
                                </Button>
                            </div>
                        )}

                        <ScrollArea className="flex-1">
                            <div className="p-2">
                                {loadingFiles ? (
                                    <div className="flex justify-center p-4"><Loader2 className="animate-spin text-slate-400" /></div>
                                ) : files.length === 0 ? (
                                    <div className="text-center p-4 text-xs text-slate-400">No files found</div>
                                ) : (
                                    renderTree(files)
                                )}
                            </div>
                        </ScrollArea>
                    </div>

                    {/* Editor Canvas */}
                    <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e]">
                        {selectedFilePath ? (
                            <>
                                <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#252526] text-white">
                                    <div className="flex items-center gap-2 text-sm font-mono truncate">
                                        <span className="text-slate-400">{selectedFilePath}</span>
                                        {isDirty && <span className="w-2 h-2 rounded-full bg-amber-500 inline-block ml-2"></span>}
                                    </div>
                                    <Button
                                        size="sm"
                                        disabled={!isDirty || saving}
                                        onClick={handleSave}
                                        className="h-7 bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-slate-700 disabled:text-slate-400"
                                    >
                                        {saving ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <Save size={12} className="mr-1.5" />}
                                        Save
                                    </Button>
                                </div>
                                <div className="flex-1 relative">
                                    {loadingContent && (
                                        <div className="absolute inset-0 bg-[#1e1e1e]/80 flex items-center justify-center z-10">
                                            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                                        </div>
                                    )}
                                    <Editor
                                        height="100%"
                                        language={
                                            selectedFilePath.endsWith('.ts') ? 'typescript' :
                                                selectedFilePath.endsWith('.js') ? 'javascript' :
                                                    selectedFilePath.endsWith('.json') ? 'json' :
                                                        selectedFilePath.endsWith('.md') ? 'markdown' :
                                                            'plaintext'
                                        }
                                        theme="vs-dark"
                                        value={fileContent}
                                        onChange={(val) => setFileContent(val || '')}
                                        options={{
                                            minimap: { enabled: false },
                                            fontSize: 13,
                                            fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
                                            scrollBeyondLastLine: false,
                                            roundedSelection: false,
                                            padding: { top: 16 }
                                        }}
                                    />
                                </div>
                            </>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 bg-slate-50">
                                <FileCode2 size={48} className="text-slate-300 mb-4" />
                                <p>Select a file to start editing</p>
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
