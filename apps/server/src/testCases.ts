import fs from 'fs-extra';
import path from 'path';
import { EventEmitter } from 'events';
import { TestCase, TestCaseCreateInput, TestCaseUpdateInput } from '@qa/types';

export class TestCaseManager extends EventEmitter {
    private storageFile: string;
    private testCases: TestCase[] = [];

    constructor() {
        super();
        this.storageFile = path.join(__dirname, '../storage/testCases.json');
        this.init();
    }

    private init() {
        fs.ensureDirSync(path.dirname(this.storageFile));

        if (fs.existsSync(this.storageFile)) {
            try {
                this.testCases = fs.readJsonSync(this.storageFile);
            } catch (error) {
                console.error('Failed to load test cases:', error);
                this.testCases = [];
            }
        } else {
            this.testCases = [];
            this.save();
        }
    }

    private save() {
        fs.writeJsonSync(this.storageFile, this.testCases, { spaces: 2 });
        this.emit('updated');
    }

    getAll(): TestCase[] {
        return this.testCases;
    }

    get(id: string): TestCase | undefined {
        return this.testCases.find(tc => tc.id === id);
    }

    create(data: TestCaseCreateInput): TestCase {
        const testCase: TestCase = {
            id: `tc-${Date.now()}`,
            ...data,
            version: 1,
            history: [{
                version: 1,
                updatedAt: Date.now(),
                changes: 'Initial creation'
            }],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        this.testCases.push(testCase);
        this.save();
        return testCase;
    }

    update(id: string, data: TestCaseUpdateInput): TestCase | null {
        const index = this.testCases.findIndex(tc => tc.id === id);
        if (index === -1) return null;

        const existing = this.testCases[index];
        const newVersion = (existing.version || 1) + 1;
        
        const historyEntry = {
            version: newVersion,
            updatedAt: Date.now(),
            changes: data.changeReason || `Updated to version ${newVersion}`
        };

        // Remove changeReason before saving to avoid polluting the object
        const { changeReason, ...updateFields } = data;

        const updatedTestCase: TestCase = {
            ...existing,
            ...updateFields,
            version: newVersion,
            history: [...(existing.history || []), historyEntry],
            updatedAt: Date.now()
        };

        this.testCases[index] = updatedTestCase;
        this.save();
        return updatedTestCase;
    }

    delete(id: string): boolean {
        const index = this.testCases.findIndex(tc => tc.id === id);
        if (index === -1) return false;

        this.testCases[index].isDeleted = true;
        this.testCases[index].deletedAt = Date.now();
        this.save();
        return true;
    }

    restore(id: string): boolean {
        const index = this.testCases.findIndex(tc => tc.id === id);
        if (index === -1) return false;

        this.testCases[index].isDeleted = false;
        delete this.testCases[index].deletedAt;
        this.save();
        return true;
    }

    hardDelete(id: string): boolean {
        const index = this.testCases.findIndex(tc => tc.id === id);
        if (index === -1) return false;

        this.testCases.splice(index, 1);
        this.save();
        return true;
    }
}
