import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from 'sonner';
import { Plus, Trash2, Calendar, Play, Settings2 } from 'lucide-react';
import { TestSchedule, Project, Agent } from '@qa/types';
import { ScheduleEditorDialog } from './ScheduleEditorDialog';

interface SchedulesDialogProps {
    isOpen: boolean;
    onClose: () => void;
    projects: Project[];
    agents: Agent[];
}

export function SchedulesDialog({ isOpen, onClose, projects, agents }: SchedulesDialogProps) {
    const [schedules, setSchedules] = useState<TestSchedule[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // Add state for schedule editor later
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editingSchedule, setEditingSchedule] = useState<TestSchedule | undefined>();
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    const fetchSchedules = async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/schedules');
            if (res.ok) {
                const data = await res.json();
                setSchedules(data);
            } else {
                toast.error('Failed to load schedules');
            }
        } catch (error) {
            console.error(error);
            toast.error('Error loading schedules');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchSchedules();
        }
    }, [isOpen]);

    const handleDelete = async (id: string) => {
        setDeleteConfirmId(id);
    };

    const confirmDelete = async () => {
        if (!deleteConfirmId) return;
        const id = deleteConfirmId;
        setDeleteConfirmId(null);
        try {
            const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success('Schedule deleted');
                fetchSchedules();
            } else {
                toast.error('Failed to delete schedule');
            }
        } catch (error) {
            toast.error('Error deleting schedule');
        }
    };

    const toggleActive = async (schedule: TestSchedule) => {
        try {
            const res = await fetch(`/api/schedules/${schedule.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive: !schedule.isActive })
            });
            if (res.ok) {
                fetchSchedules();
                toast.success(`Schedule ${!schedule.isActive ? 'activated' : 'deactivated'}`);
            } else {
                toast.error('Failed to update schedule status');
            }
        } catch (error) {
            toast.error('Error updating schedule');
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center justify-between pr-8">
                        <div className="flex items-center gap-2">
                            <Calendar className="w-5 h-5" />
                            <span>Task Schedules</span>
                        </div>
                        <Button size="sm" onClick={() => { setEditingSchedule(undefined); setIsEditorOpen(true); }}>
                            <Plus className="w-4 h-4 mr-1" /> New Schedule
                        </Button>
                    </DialogTitle>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto pr-4">
                    {isLoading ? (
                        <div className="text-center py-8 text-neutral-500">Loading schedules...</div>
                    ) : schedules.length === 0 ? (
                        <div className="text-center py-12 bg-neutral-900 border border-neutral-800 rounded-lg text-neutral-500">
                            No schedules found. Create one to run tasks automatically.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {schedules.map(s => (
                                <div key={s.id} className="flex items-center justify-between p-4 bg-neutral-800/50 border border-neutral-700 rounded-lg hover:border-neutral-600 transition-colors">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <h4 className="font-medium text-white">{s.name}</h4>
                                            <Badge variant={s.isActive ? "default" : "secondary"} className={s.isActive ? "bg-green-500/20 text-green-300" : "text-neutral-300"}>
                                                {s.isActive ? 'Active' : 'Inactive'}
                                            </Badge>
                                        </div>
                                        <div className="text-sm text-neutral-300 flex items-center gap-4">
                                            <span className="flex items-center gap-1"><Play className="w-3 h-3 text-neutral-400" /> {s.scriptId}</span>
                                            <span className="flex items-center gap-1"><Settings2 className="w-3 h-3 text-neutral-400" /> {s.cronExpression}</span>
                                            <span className="text-xs ml-2 text-neutral-400">{s.targets.length} targets</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button variant="outline" size="sm" onClick={() => toggleActive(s)}>
                                            {s.isActive ? 'Deactivate' : 'Activate'}
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={() => { setEditingSchedule(s); setIsEditorOpen(true); }}>
                                            Edit
                                        </Button>
                                        <Button variant="destructive" size="icon" onClick={() => handleDelete(s.id)}>
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </DialogContent>

            {isEditorOpen && (
                <ScheduleEditorDialog
                    isOpen={isEditorOpen}
                    onClose={() => setIsEditorOpen(false)}
                    schedule={editingSchedule}
                    projects={projects}
                    agents={agents}
                    onSaved={fetchSchedules}
                />
            )}

            <Dialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Schedule</DialogTitle>
                    </DialogHeader>
                    <p className="text-slate-600">Are you sure you want to delete this schedule? This action cannot be undone.</p>
                    <div className="mt-4 flex gap-2 justify-end">
                        <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={confirmDelete}>
                            Delete
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </Dialog>
    );
}
