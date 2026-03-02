import React, { useRef, useState } from 'react';
import axios from 'axios';
import { Card, CardContent } from "@/components/ui/card";

import { UploadCloud, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface ProjectUploaderProps {
    onProjectUploaded: () => void;
}

export const ProjectUploader: React.FC<ProjectUploaderProps> = ({ onProjectUploaded }) => {
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            await axios.post('/api/projects', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            toast.success('Project uploaded successfully');
            if (fileInputRef.current) fileInputRef.current.value = '';
            onProjectUploaded();
        } catch (error) {
            console.error('Upload failed:', error);
            toast.error('Failed to upload project');
        } finally {
            setUploading(false);
        }
    };

    return (
        <Card
            className="border-slate-200/60 shadow-sm border-dashed border-2 bg-slate-50/50 hover:bg-slate-100/50 cursor-pointer transition-all group overflow-hidden flex flex-col h-full min-h-[140px]"
            onClick={handleUploadClick}
        >
            <CardContent className="p-4 flex flex-col items-center justify-center gap-3 w-full flex-1">
                <input
                    type="file"
                    accept=".zip"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                />

                {uploading ? (
                    <>
                        <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
                        <span className="text-sm font-bold text-slate-700">Uploading Project...</span>
                    </>
                ) : (
                    <>
                        <div className="p-1.5 bg-indigo-100/50 rounded-md group-hover:bg-indigo-200/50 transition-colors">
                            <UploadCloud className="w-4 h-4 text-indigo-600" />
                        </div>
                        <span className="text-sm font-bold text-slate-600 group-hover:text-indigo-600 transition-colors">
                            Upload New Project (.zip)
                        </span>
                    </>
                )}
            </CardContent>
        </Card>
    );
};
