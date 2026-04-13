import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TestSuite } from '@qa/types';

interface TestSuiteDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: { name: string, description?: string, parentId?: string | null }) => void;
    initialData?: TestSuite | null;
    initialParentId?: string | null;
}

export function TestSuiteDialog({ isOpen, onClose, onSave, initialData, initialParentId }: TestSuiteDialogProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');

    useEffect(() => {
        if (isOpen) {
            setName(initialData?.name || '');
            setDescription(initialData?.description || '');
        }
    }, [isOpen, initialData]);

    const handleSave = () => {
        if (!name.trim()) return;

        onSave({
            name,
            description,
            parentId: initialData ? initialData.parentId : initialParentId
        });
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[425px] bg-slate-50 border-slate-200">
                <DialogHeader className="bg-white border-b border-slate-200 pb-4 mb-4">
                    <DialogTitle className="text-xl font-bold flex items-center gap-2 text-slate-800">
                        {initialData ? 'Edit Test Suite' : 'Create Test Suite'}
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="grid gap-2">
                        <label className="text-sm font-bold text-slate-700">Suite Name <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            className="flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="E.g., Authentication Tests"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div className="grid gap-2">
                        <label className="text-sm font-bold text-slate-700">Description</label>
                        <textarea
                            className="flex min-h-[80px] w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Optional description"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                        />
                    </div>
                </div>

                <DialogFooter className="mt-6 border-t border-slate-200 pt-4">
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSave} className="bg-blue-600 text-white hover:bg-blue-700" disabled={!name.trim()}>
                        {initialData ? 'Update' : 'Create'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
