import { AgentDeviceState, mapAdbStatus } from '@samsung-maintenance/shared';
import {
  AdbExecutor,
  AdbDevice,
  HardwareInfo,
  executeAdb,
  parseAdbDevices,
  readBatteryLevel,
  readDeviceProperties,
} from './adb';

const PROPERTIES_REFRESH_MS = 15 * 60 * 1000;
const BATTERY_REFRESH_MS = 60 * 1000;
const RETRY_DELAY_MS = 30 * 1000;

export interface DeviceObservation {
  serialNumber: string;
  state: AgentDeviceState;
  model?: string;
  androidVersion?: string;
  batteryLevel?: number;
}

interface CachedDevice extends HardwareInfo {
  propertiesUpdatedAt?: number;
  propertiesAttemptAt?: number;
  batteryUpdatedAt?: number;
  batteryAttemptAt?: number;
}

export interface MonitorLogger {
  error(message: string): void;
}

export class DeviceMonitor {
  private readonly cache = new Map<string, CachedDevice>();
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly execute: AdbExecutor = executeAdb,
    private readonly logger: MonitorLogger = console,
    private readonly now: () => number = Date.now,
  ) {}

  async scan(): Promise<DeviceObservation[]> {
    const devices = parseAdbDevices(await this.execute(['devices']));
    const onlineSerials = new Set(
      devices.filter((device) => device.status === 'device').map((device) => device.serialNumber),
    );

    for (const serialNumber of this.cache.keys()) {
      if (!onlineSerials.has(serialNumber)) this.cache.delete(serialNumber);
    }

    for (const serialNumber of onlineSerials) this.refreshInBackground(serialNumber);

    return devices.map((device) => {
      const { model, androidVersion, batteryLevel } =
        this.cache.get(device.serialNumber) ?? {};
      return {
        serialNumber: device.serialNumber,
        state: mapAdbStatus(device.status),
        ...(model ? { model } : {}),
        ...(androidVersion ? { androidVersion } : {}),
        ...(batteryLevel !== undefined ? { batteryLevel } : {}),
      };
    });
  }

  private refreshInBackground(serialNumber: string): void {
    if (this.inFlight.has(serialNumber)) return;

    const now = this.now();
    const cached = this.cache.get(serialNumber) ?? {};
    const propertiesDue = this.isDue(
      cached.propertiesUpdatedAt,
      cached.propertiesAttemptAt,
      now,
      PROPERTIES_REFRESH_MS,
    );
    const batteryDue = this.isDue(
      cached.batteryUpdatedAt,
      cached.batteryAttemptAt,
      now,
      BATTERY_REFRESH_MS,
    );

    if (!propertiesDue && !batteryDue) return;

    this.inFlight.add(serialNumber);
    this.cache.set(serialNumber, cached);
    void this.refresh(serialNumber, cached, propertiesDue, batteryDue, now)
      .catch(() => this.logger.error(`ADB ${serialNumber} hardware refresh failed`))
      .finally(() => this.inFlight.delete(serialNumber));
  }

  private isDue(
    lastSuccessAt: number | undefined,
    lastAttemptAt: number | undefined,
    now: number,
    refreshInterval: number,
  ): boolean {
    if (lastSuccessAt !== undefined) return now - lastSuccessAt >= refreshInterval;
    return lastAttemptAt === undefined || now - lastAttemptAt >= RETRY_DELAY_MS;
  }

  private async refresh(
    serialNumber: string,
    cached: CachedDevice,
    propertiesDue: boolean,
    batteryDue: boolean,
    now: number,
  ): Promise<void> {
    if (propertiesDue) {
      cached.propertiesAttemptAt = now;
      const { info, errors } = await readDeviceProperties(serialNumber, this.execute);
      Object.assign(cached, info);
      if (info.model && info.androidVersion) cached.propertiesUpdatedAt = now;
      for (const error of errors) this.logger.error(`ADB ${serialNumber} ${error}`);
    }

    if (batteryDue) {
      cached.batteryAttemptAt = now;
      const result = await readBatteryLevel(serialNumber, this.execute);
      if (result.batteryLevel !== undefined) {
        cached.batteryLevel = result.batteryLevel;
        cached.batteryUpdatedAt = now;
      }
      if (result.error) this.logger.error(`ADB ${serialNumber} ${result.error}`);
    }
  }
}
