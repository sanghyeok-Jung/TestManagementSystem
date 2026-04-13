import fs from 'fs-extra';
import path from 'path';
import { EventEmitter } from 'events';
import { TestSuite, TestSuiteCreateInput, TestSuiteUpdateInput } from '@qa/types';
import { TestCaseManager } from './testCases';

export class TestSuiteManager extends EventEmitter {
    private storageFile: string;
    private testSuites: TestSuite[] = [];
    private testCaseManager: TestCaseManager;

    constructor(testCaseManager: TestCaseManager) {
        super();
        this.storageFile = path.join(__dirname, '../storage/testSuites.json');
        this.testCaseManager = testCaseManager;
        this.init();
    }

    private init() {
        fs.ensureDirSync(path.dirname(this.storageFile));

        if (fs.existsSync(this.storageFile)) {
            try {
                this.testSuites = fs.readJsonSync(this.storageFile);
            } catch (error) {
                console.error('Failed to load test suites:', error);
                this.testSuites = [];
            }
        } else {
            this.testSuites = [];
            this.save();
        }
    }

    private save() {
        fs.writeJsonSync(this.storageFile, this.testSuites, { spaces: 2 });
        this.emit('updated');
    }

    getAll(): TestSuite[] {
        return this.testSuites;
    }

    get(id: string): TestSuite | undefined {
        return this.testSuites.find(ts => ts.id === id);
    }

    create(data: TestSuiteCreateInput): TestSuite {
        const testSuite: TestSuite = {
            id: `ts-${Date.now()}`,
            ...data,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        this.testSuites.push(testSuite);
        this.save();
        return testSuite;
    }

    update(id: string, data: TestSuiteUpdateInput): TestSuite | null {
        const index = this.testSuites.findIndex(ts => ts.id === id);
        if (index === -1) return null;

        const updatedTestSuite = {
            ...this.testSuites[index],
            ...data,
            updatedAt: Date.now()
        };

        // Prevent circular Parent-Child relationships
        if (updatedTestSuite.parentId === id) {
            updatedTestSuite.parentId = null;
        }

        this.testSuites[index] = updatedTestSuite;
        this.save();
        return updatedTestSuite;
    }

    delete(id: string): boolean {
        const index = this.testSuites.findIndex(ts => ts.id === id);
        if (index === -1) return false;

        // Cascade soft delete child suites
        const childSuites = this.testSuites.filter(ts => ts.parentId === id);
        childSuites.forEach(child => this.delete(child.id));

        // Soft delete test cases that belong to this suite
        const testCasesInSuite = this.testCaseManager.getAll().filter(tc => tc.suiteId === id);
        testCasesInSuite.forEach(tc => this.testCaseManager.delete(tc.id)); // Calls soft delete

        this.testSuites[index].isDeleted = true;
        this.testSuites[index].deletedAt = Date.now();
        this.save();
        return true;
    }

    restore(id: string): boolean {
        const index = this.testSuites.findIndex(ts => ts.id === id);
        if (index === -1) return false;

        const suite = this.testSuites[index];
        suite.isDeleted = false;
        delete suite.deletedAt;

        // If parent is deleted, detach from parent to become a root suite
        if (suite.parentId) {
            const parent = this.get(suite.parentId);
            if (!parent || parent.isDeleted) {
                suite.parentId = null;
            }
        }

        this.save();
        return true;
    }

    hardDelete(id: string): boolean {
        const index = this.testSuites.findIndex(ts => ts.id === id);
        if (index === -1) return false;

        // Cascade hard delete child suites
        const childSuites = this.testSuites.filter(ts => ts.parentId === id);
        childSuites.forEach(child => this.hardDelete(child.id));

        // Hard delete test cases that belong to this suite
        const testCasesInSuite = this.testCaseManager.getAll().filter(tc => tc.suiteId === id);
        testCasesInSuite.forEach(tc => this.testCaseManager.hardDelete(tc.id));

        this.testSuites.splice(index, 1);
        this.save();
        return true;
    }
}
