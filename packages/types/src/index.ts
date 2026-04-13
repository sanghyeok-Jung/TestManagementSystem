export interface Agent {
  id: string;
  hostname: string;
  ip: string;
  devices: Device[];
  status: 'online' | 'offline';
  queueLength?: number;
}

export interface Device {
  id: string;
  model: string;
  manufacturer: string;
  platform?: 'android' | 'ios';
  osVersion?: string;
  status: 'available' | 'busy' | 'offline';
  jobStatus?: 'idle' | 'running';
  queueLength?: number;
}

export interface TestJob {
  id: string;
  scriptId: string;
  targetDeviceId?: string; // Optional for agent-level jobs
  targetAgentId?: string;
  command: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
}

export interface LogEntry {
  jobId: string;
  type: 'stdout' | 'stderr' | 'system';
  message: string;
  timestamp: number;
}

export interface ProjectParameter {
  key: string;
  description?: string;
  defaultValue?: string;
  required?: boolean;
  options?: string[];
}

export interface ProjectScript {
  name: string;
  command: string;
  description?: string;
  type?: 'mobile' | 'api' | 'browser';
  parameters?: ProjectParameter[];
}

export interface ProjectMetadata {
  name?: string;
  description?: string;
  parameters?: ProjectParameter[]; // Global parameters
  scripts?: ProjectScript[]; // Selectable scripts
}

export interface Project {
  id: string; // Directory name like proj-timestamp
  name: string; // Original filename or derived name
  uploadedAt: number;
  status: 'processing' | 'ready' | 'error' | 'deleting';
  metadata?: ProjectMetadata;
}

export interface ScriptParameter {
  key: string;
  value: string;
  options?: string[];
  description?: string;
  required?: boolean;
}

export interface SelectedScriptInstance {
  scriptIndex: number;
  parameters: ScriptParameter[];
}

export interface ScheduleTarget {
  agentId: string;
  deviceId: string | null; // null means any available device on the agent
}

export interface TestSchedule {
  id: string;
  name: string;
  scriptId: string;
  command: string;
  selectedScripts?: SelectedScriptInstance[];
  targets: ScheduleTarget[];
  cronExpression: string; // e.g., "0 9 * * *" for every day at 9 AM
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
}

export interface TestCaseStep {
  action: string;
  expectedResult: string;
}

export interface TestCaseHistoryEntry {
  version: number;
  updatedAt: number;
  changes?: string; // Optional message describing changes
}

export interface TestSuite {
  id: string;
  name: string;
  description?: string;
  parentId?: string | null;
  isDeleted?: boolean;
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type TestSuiteCreateInput = Omit<TestSuite, 'id' | 'createdAt' | 'updatedAt'>;
export type TestSuiteUpdateInput = Partial<TestSuiteCreateInput>;

export interface TestCase {
  id: string;
  suiteId?: string | null; // Optional now, test cases can exist without a suite
  projectId?: string;
  title: string;
  description?: string;
  preconditions?: string;
  steps: TestCaseStep[];
  expectedResult?: string; // Optional top-level overall expected result
  status: 'draft' | 'active' | 'deprecated';
  priority: 'high' | 'medium' | 'low';
  type: 'auto' | 'manual';
  links?: string[];
  version: number;
  history?: TestCaseHistoryEntry[];
  isDeleted?: boolean;
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type TestCaseCreateInput = Omit<TestCase, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'history'>;
export type TestCaseUpdateInput = Partial<TestCaseCreateInput> & {
  changeReason?: string; // Optional field passed dynamically to log the history
};
