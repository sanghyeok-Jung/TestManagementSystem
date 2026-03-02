import React, { useEffect, useState } from 'react';
import { ProjectUploader } from './ProjectUploader';
import { ProjectEditorDialog } from './ProjectEditorDialog';
import axios from 'axios';
import { Project } from '@qa/types';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Play, Calendar, Loader2, RefreshCw, FileEdit } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from "@/lib/utils";

interface ProjectListProps {
    refreshTrigger: number;
    onRunProject: (project: Project) => void;
}

export const ProjectList: React.FC<ProjectListProps> = ({ refreshTrigger, onRunProject }) => {
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [editingProject, setEditingProject] = useState<Project | null>(null);

    const fetchProjects = async () => {
        setLoading(true);
        try {
            const response = await axios.get<Project[]>('/api/projects');
            // Sort by uploadedAt desc
            const sorted = response.data.sort((a, b) => b.uploadedAt - a.uploadedAt);
            setProjects(sorted);
        } catch (error) {
            console.error('Failed to fetch projects:', error);
            toast.error('Failed to load projects');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProjects();
    }, [refreshTrigger]);

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!window.confirm('Are you sure you want to delete this project?')) return;

        setDeletingId(id);

        // Optimistically set status to deleting
        setProjects(prev => prev.map(p => p.id === id ? { ...p, status: 'deleting' } : p));

        try {
            await axios.delete(`/api/projects/${id}`);
            toast.success('Project deleted');
            // Remove from list immediately upon success 
            // (or let the websocket project_updated event handle the refresh)
            setProjects(prev => prev.filter(p => p.id !== id));
        } catch (error) {
            console.error('Failed to delete project:', error);
            toast.error('Failed to delete project');
            // Revert optimistic update
            fetchProjects();
        } finally {
            setDeletingId(null);
        }
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleString();
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-end px-1 mb-2">
                <Button variant="ghost" size="sm" className="h-6 text-xs text-slate-400 hover:text-indigo-500 flex items-center gap-1.5" onClick={fetchProjects}>
                    <RefreshCw size={12} className={cn(loading && "animate-spin")} /> Refresh
                </Button>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
                <ProjectUploader onProjectUploaded={fetchProjects} />

                {loading && projects.length === 0 ? (
                    <div className="col-span-full text-center py-8 text-slate-400">
                        <Loader2 size={24} className="animate-spin mx-auto mb-2" />
                        <p className="text-xs">Loading projects...</p>
                    </div>
                ) : projects.length === 0 ? (
                    <div className="col-span-full text-center py-8 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                        <p className="text-slate-400 text-sm font-medium">No projects found</p>
                    </div>
                ) : (
                    projects.map(project => (
                        <Card key={project.id} className="group overflow-hidden border-slate-200/60 shadow-sm hover:shadow-md transition-all flex flex-col h-full">
                            <CardContent className="p-4 flex flex-col justify-between flex-1 gap-4">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                        <h3 className="font-bold text-slate-900 truncate" title={project.name}>
                                            {project.name}
                                        </h3>
                                        <Badge variant="outline" className={cn(
                                            "shrink-0 text-[9px] px-1.5 py-0 h-4",
                                            project.status === 'ready' ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                                                project.status === 'error' ? "bg-rose-50 text-rose-600 border-rose-100" :
                                                    project.status === 'deleting' ? "bg-slate-100 text-slate-500 border-slate-200 animate-pulse" :
                                                        "bg-amber-50 text-amber-600 border-amber-100"
                                        )}>
                                            {project.status.toUpperCase()}
                                        </Badge>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-slate-500">
                                        <div className="flex items-center gap-1">
                                            <Calendar size={10} />
                                            <span>{formatDate(project.uploadedAt)}</span>
                                        </div>
                                    </div>
                                    <div className="text-[10px] text-slate-400 font-mono mt-1.5 truncate" title={project.id}>
                                        {project.id}
                                    </div>
                                </div>

                                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 mt-auto">
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                                        onClick={() => setEditingProject(project)}
                                        disabled={project.status !== 'ready' || deletingId === project.id}
                                        title="Edit Code"
                                    >
                                        <FileEdit size={14} />
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="default"
                                        className="h-8 flex-1 bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                                        onClick={() => onRunProject(project)}
                                        disabled={project.status !== 'ready' || deletingId === project.id}
                                    >
                                        <Play size={12} className="mr-1.5" /> Run
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                        onClick={(e) => handleDelete(project.id, e)}
                                        disabled={deletingId === project.id}
                                    >
                                        {deletingId === project.id ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                            <Trash2 size={14} />
                                        )}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </div>

            {editingProject && (
                <ProjectEditorDialog
                    isOpen={!!editingProject}
                    onClose={() => setEditingProject(null)}
                    project={editingProject}
                />
            )}
        </div>
    );
};
