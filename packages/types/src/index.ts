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
