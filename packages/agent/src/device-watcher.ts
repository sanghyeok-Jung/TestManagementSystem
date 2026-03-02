import execa from 'execa';
import { Device } from '@qa/types';

export class DeviceWatcher {
    private devices: Device[] = [];
    private interval: NodeJS.Timeout | null = null;
    private onChange: (devices: Device[]) => void;

    constructor(onChange: (devices: Device[]) => void) {
        this.onChange = onChange;
    }

    start() {
        this.poll();
        this.interval = setInterval(() => this.poll(), 3000);
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
    }

    private deviceDetailsCache = new Map<string, { manufacturer: string, osVersion: string, model: string }>();

    private async poll() {
        try {
            // Android devices via ADB
            const { stdout: adbStdout } = await execa('adb', ['devices', '-l']);
            const androidDevices = await this.parseAdbOutput(adbStdout);

            // iOS devices via idevice_id
            let iosDevices: Device[] = [];
            try {
                const { stdout: iosStdout } = await execa('idevice_id', ['-l']);
                iosDevices = await this.parseIosOutput(iosStdout);
            } catch (e) {
                // Ignore if idevice_id is not available or fails
            }

            const allDevices = [...androidDevices, ...iosDevices];

            // Cleanup cache for disconnected devices
            const currentIds = new Set(allDevices.map(d => d.id));
            for (const key of this.deviceDetailsCache.keys()) {
                if (!currentIds.has(key)) {
                    this.deviceDetailsCache.delete(key);
                }
            }

            if (this.hasChanged(allDevices)) {
                this.devices = allDevices;
                this.onChange(this.devices);
            }
        } catch (error) {
            console.error('Error polling devices:', error);
        }
    }

    private async fetchAndroidDeviceDetails(id: string, status: string) {
        if (status !== 'available') {
            return { manufacturer: 'Unknown', osVersion: 'Unknown', model: 'Unknown' };
        }
        if (this.deviceDetailsCache.has(id)) {
            return this.deviceDetailsCache.get(id)!;
        }
        try {
            const { stdout: osVersion } = await execa('adb', ['-s', id, 'shell', 'getprop', 'ro.build.version.release'], { timeout: 2000 });
            const { stdout: manufacturer } = await execa('adb', ['-s', id, 'shell', 'getprop', 'ro.product.manufacturer'], { timeout: 2000 });
            const { stdout: modelStdout } = await execa('adb', ['-s', id, 'shell', 'settings', 'get', 'global', 'device_name'], { timeout: 2000 });

            const details = {
                manufacturer: manufacturer.trim() || 'Unknown',
                osVersion: osVersion.trim() || 'Unknown',
                model: modelStdout.trim() || 'Unknown'
            };
            this.deviceDetailsCache.set(id, details);
            return details;
        } catch (e) {
            return { manufacturer: 'Unknown', osVersion: 'Unknown', model: 'Unknown' };
        }
    }

    private async fetchIosDeviceDetails(id: string, status: string) {
        if (status !== 'available') {
            return { manufacturer: 'Apple', osVersion: 'Unknown', model: 'Unknown' };
        }
        if (this.deviceDetailsCache.has(id)) {
            return this.deviceDetailsCache.get(id)!;
        }
        try {
            const { stdout: osVersion } = await execa('ideviceinfo', ['-u', id, '-k', 'ProductVersion'], { timeout: 2000 });
            const { stdout: deviceName } = await execa('ideviceinfo', ['-u', id, '-k', 'DeviceName'], { timeout: 2000 });

            const details = {
                manufacturer: 'Apple',
                osVersion: osVersion.trim() || 'Unknown',
                model: deviceName.trim() || 'Unknown'
            };
            this.deviceDetailsCache.set(id, details);
            return details;
        } catch (e) {
            return { manufacturer: 'Apple', osVersion: 'Unknown', model: 'Unknown' };
        }
    }

    private async parseAdbOutput(stdout: string): Promise<Device[]> {
        const lines = stdout.split('\n').filter(line => line.trim() !== '' && !line.startsWith('List of devices'));

        const devices = await Promise.all(lines.map(async line => {
            const parts = line.split(/\s+/);
            const id = parts[0];
            const status = parts[1] === 'device' ? 'available' : 'offline';

            const details = await this.fetchAndroidDeviceDetails(id, status);

            return {
                id,
                status: status as 'available' | 'busy' | 'offline',
                model: details.model,
                manufacturer: details.manufacturer,
                platform: 'android' as const,
                osVersion: details.osVersion
            };
        }));

        return devices;
    }

    private async parseIosOutput(stdout: string): Promise<Device[]> {
        const lines = stdout.split('\n').filter(line => line.trim() !== '');

        const devices = await Promise.all(lines.map(async line => {
            const parts = line.split(/\s+/);
            const id = parts[0]; // idevice_id -l prints the UDID first
            const status = 'available'; // If it shows up here, it's typically available via USB/Network

            const details = await this.fetchIosDeviceDetails(id, status);

            return {
                id,
                status: status as 'available' | 'busy' | 'offline',
                model: details.model,
                manufacturer: details.manufacturer,
                platform: 'ios' as const,
                osVersion: details.osVersion
            };
        }));

        return devices;
    }

    private hasChanged(newDevices: Device[]): boolean {
        if (newDevices.length !== this.devices.length) return true;
        // Compare essential fields to avoid unnecessary updates if order changes or minor ref pulls happen
        return JSON.stringify(newDevices) !== JSON.stringify(this.devices);
    }
}
