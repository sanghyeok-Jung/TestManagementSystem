import fs from 'fs-extra';
import path from 'path';
import extract from 'extract-zip';
import { Project } from '@qa/types';
import { pipeline } from 'stream/promises';
import { EventEmitter } from 'events';

export class ProjectManager extends EventEmitter {
    private storageFile: string;
    private uploadsDir: string;
    private projects: Project[] = [];
    private activeExtractions: Map<string, AbortController> = new Map();

    constructor() {
        super();
        this.storageFile = path.join(__dirname, '../storage/projects.json');
        this.uploadsDir = path.join(__dirname, '../uploads/projects');
        this.init();
    }

    private init() {
        fs.ensureDirSync(path.dirname(this.storageFile));
        fs.ensureDirSync(this.uploadsDir);

        if (fs.existsSync(this.storageFile)) {
            try {
                this.projects = fs.readJsonSync(this.storageFile);
                // Background sync on startup to ensure tms.json matches db
                this.syncAllProjects().catch(err => console.error('Failed to sync projects on startup:', err));
            } catch (error) {
                console.error('Failed to load projects:', error);
                this.projects = [];
            }
        }
    }

    private async syncAllProjects() {
        console.log('[ProjectManager] Syncing all projects on startup...');
        let updated = false;
        for (const project of this.projects) {
            if (project.status === 'ready') {
                const didUpdate = await this.syncProjectMetadata(project.id, false);
                if (didUpdate) updated = true;
            }
        }
        if (updated) {
            console.log('[ProjectManager] Sync complete. Some projects were updated.');
            this.save();
        } else {
            console.log('[ProjectManager] Sync complete. No changes detected.');
        }
    }

    private async syncProjectMetadata(id: string, saveOnChange = true): Promise<boolean> {
        const project = this.projects.find(p => p.id === id);
        if (!project || (project.status !== 'ready' && project.status !== 'processing')) return false;

        const outputDir = path.join(this.uploadsDir, id);
        if (!fs.existsSync(outputDir)) return false;

        try {
            const items = await fs.readdir(outputDir);
            const validItems = items.filter(item => item !== 'source.zip' && item !== '__MACOSX' && !item.startsWith('.'));

            let workingDir = outputDir;
            if (validItems.length === 1) {
                const potentialDir = path.join(outputDir, validItems[0]);
                const stats = await fs.stat(potentialDir);
                if (stats.isDirectory()) {
                    workingDir = potentialDir;
                }
            }

            const tmsJsonPath = path.join(workingDir, 'tms.json');
            if (fs.existsSync(tmsJsonPath)) {
                const metadata = await fs.readJson(tmsJsonPath);

                // Deep compare to avoid unnecessary saves (simple JSON stringify is enough here)
                if (JSON.stringify(project.metadata) !== JSON.stringify(metadata)) {
                    project.metadata = metadata;
                    console.log(`[Project] Metadata synced and updated for ${id}`);
                    if (saveOnChange) this.save();
                    return true;
                }
            } else if (project.metadata) {
                // tms.json was deleted
                delete project.metadata;
                console.log(`[Project] Metadata removed for ${id} (tms.json not found)`);
                if (saveOnChange) this.save();
                return true;
            }
        } catch (err) {
            console.error(`[Project] Failed to sync metadata for ${id}:`, err);
        }
        return false;
    }

    private save() {
        fs.writeJsonSync(this.storageFile, this.projects, { spaces: 2 });
        this.emit('updated');
    }

    getAll(): Project[] {
        return this.projects;
    }

    get(id: string): Project | undefined {
        return this.projects.find(p => p.id === id);
    }

    async create(file: any): Promise<Project> {
        const id = `proj-${Date.now()}`;
        const outputDir = path.join(this.uploadsDir, id);

        // Ensure upload directory exists
        await fs.ensureDir(outputDir);

        // Save original zip
        const zipPath = path.join(outputDir, 'source.zip');
        await pipeline(file.file, fs.createWriteStream(zipPath));

        const project: Project = {
            id,
            name: file.filename.replace('.zip', ''),
            uploadedAt: Date.now(),
            status: 'processing'
        };

        this.projects.push(project);
        this.save();

        // Used to signal abortion if the project is deleted during extraction
        const abortController = new AbortController();
        this.activeExtractions.set(id, abortController);

        // Extract zip
        try {
            await extract(zipPath, { dir: outputDir });

            if (abortController.signal.aborted) {
                console.log(`[Project] Extraction completed for ${id}, but project was deleted. Cleaning up.`);
                await fs.remove(outputDir).catch(err => console.error('Failed to cleanup aborted project files:', err));
                return project;
            }

            const p = this.projects.find(p => p.id === id);
            if (p) {
                await this.syncProjectMetadata(id, false);

                p.status = 'ready';
                this.save();
                console.log(`[Project] Extracted ${id} successfully.`);
            }
        } catch (error) {
            if (abortController.signal.aborted) {
                console.log(`[Project] Extraction failed for ${id}, but project was deleted. Cleaning up.`);
                await fs.remove(outputDir).catch(err => console.error('Failed to cleanup aborted project files:', err));
            } else {
                console.error(`[Project] Failed to extract zip for ${id}:`, error);
                const p = this.projects.find(p => p.id === id);
                if (p) {
                    p.status = 'error';
                    this.save();
                }
            }
        } finally {
            this.activeExtractions.delete(id);
        }

        // Return the updated project object so the frontend gets metadata immediately
        const finalProject = this.projects.find(p => p.id === id);
        return finalProject || project;
    }

    async delete(id: string): Promise<boolean> {
        const index = this.projects.findIndex(p => p.id === id);
        if (index === -1) return false;

        this.projects.splice(index, 1);
        this.save();

        // If extraction is actively running, signal to abort/cleanup
        const abortController = this.activeExtractions.get(id);
        if (abortController) {
            abortController.abort();
            this.activeExtractions.delete(id);
        }

        const projectDir = path.join(this.uploadsDir, id);
        await fs.remove(projectDir).catch(err => console.error('Failed to remove project files:', err));

        return true;
    }

    // --- File Management ---

    private getProjectDir(id: string): string | null {
        const project = this.get(id);
        if (!project || project.status !== 'ready') return null;

        // Inside uploadsDir/id, we have the extracted contents. 
        // JobExecutor looks for a single top-level dir, but let's just return the root `uploadsDir/id`
        // so we can see everything including `source.zip`. We could filter it out.
        return path.join(this.uploadsDir, id);
    }

    async listFiles(id: string): Promise<any[]> {
        const dir = this.getProjectDir(id);
        if (!dir) return [];

        const walk = async (currentPath: string, relativePath: string = ''): Promise<any[]> => {
            const items = await fs.readdir(currentPath, { withFileTypes: true });
            const result = [];

            for (const item of items) {
                if (item.name === 'source.zip' || item.name === '__MACOSX' || item.name.startsWith('.')) continue;

                const itemPath = path.join(currentPath, item.name);
                const itemRelativePath = path.join(relativePath, item.name);

                if (item.isDirectory()) {
                    result.push({
                        name: item.name,
                        path: itemRelativePath,
                        type: 'directory',
                        children: await walk(itemPath, itemRelativePath)
                    });
                } else {
                    result.push({
                        name: item.name,
                        path: itemRelativePath,
                        type: 'file'
                    });
                }
            }
            return result.sort((a, b) => {
                if (a.type === b.type) return a.name.localeCompare(b.name);
                return a.type === 'directory' ? -1 : 1;
            });
        };

        return walk(dir);
    }

    async readFile(id: string, relativePath: string): Promise<string | null> {
        const dir = this.getProjectDir(id);
        if (!dir) return null;

        const filePath = path.join(dir, relativePath);

        // Security check: Prevent directory traversal escaping the project directory
        if (!filePath.startsWith(dir)) return null;

        try {
            if (!fs.existsSync(filePath)) return null;
            const stats = await fs.stat(filePath);
            if (!stats.isFile()) return null;

            return await fs.readFile(filePath, 'utf-8');
        } catch (error) {
            console.error(`Failed to read file ${filePath}:`, error);
            return null;
        }
    }

    async writeFile(id: string, relativePath: string, content: string): Promise<boolean> {
        const dir = this.getProjectDir(id);
        if (!dir) return false;

        const filePath = path.join(dir, relativePath);

        // Security check: Prevent directory traversal
        if (!filePath.startsWith(dir)) return false;

        try {
            await fs.ensureDir(path.dirname(filePath));
            await fs.writeFile(filePath, content, 'utf-8');

            if (relativePath.endsWith('tms.json')) {
                await this.syncProjectMetadata(id, true);
            }

            return true;
        } catch (error) {
            console.error(`Failed to write file ${filePath}:`, error);
            return false;
        }
    }

    async deleteFile(id: string, relativePath: string): Promise<boolean> {
        const dir = this.getProjectDir(id);
        if (!dir) return false;

        const filePath = path.join(dir, relativePath);

        // Security check: Prevent directory traversal
        if (!filePath.startsWith(dir)) return false;

        try {
            if (!fs.existsSync(filePath)) return false;

            // Protect source.zip just in case
            if (path.basename(filePath) === 'source.zip') return false;

            await fs.remove(filePath);
            return true;
        } catch (error) {
            console.error(`Failed to delete file ${filePath}:`, error);
            return false;
        }
    }
}
