export interface DeviceMetadata {
    width: number;
    height: number;
    rotation: number;
    lastUpdated: number;
    osVersion?: string;
}

export interface DeviceInputArgs {
    type: 'tap' | 'swipe' | 'key' | 'rotate' | 'text';
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    keycode?: number;
    text?: string;
    isLandscape?: boolean;
}

export interface IDeviceManager {
    getMetadata(deviceId: string, force?: boolean): Promise<DeviceMetadata | null>;
    pushFile(deviceId: string, fileId: string, filename: string): Promise<void>;
    pullFile(deviceId: string, remotePath: string): Promise<{ fileId: string, filename: string }>;
    installApp(deviceId: string, fileId: string, filename: string, logToTerminal: (msg: string, color?: "cyan" | "green" | "red" | "yellow") => void): Promise<void>;
    sendInput(deviceId: string, args: DeviceInputArgs): Promise<void>;
    /** Returns the local port for the MJPEG streaming server (iOS only, returns null for Android) */
    getMjpegPort?(deviceId: string): Promise<number | null>;
    cleanup(): Promise<void>;
}
