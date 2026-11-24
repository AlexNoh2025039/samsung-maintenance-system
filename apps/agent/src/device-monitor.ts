import {
  AgentDeviceState,
  DeviceDiagnostic,
  MaintenanceOperation,
  DeviceState,
  mapAdbStatus,
} from '@samsung-maintenance/shared';
import {
  AdbExecutor,
  AdbDevice,
  HardwareInfo,
  executeAdb,
  parseAdbDevices,
  readBatteryLevel,
  readDeviceDiagnostics,
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
  manufacturer?: string;
  buildNumber?: string;
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
  private readonly previouslySeen = new Set<string>();
  private readonly operationsInFlight = new Set<string>();

  constructor(
    private readonly execute: AdbExecutor = executeAdb,
    private readonly logger: MonitorLogger = console,
    private readonly now: () => number = Date.now,
  ) {}

  async scan(): Promise<DeviceObservation[]> {
    const devices = parseAdbDevices(await this.execute(['devices']));
    const presentSerials = new Set(devices.map((device) => device.serialNumber));
    const onlineSerials = new Set(
      devices.filter((device) => device.status === 'device').map((device) => device.serialNumber),
    );

    for (const serialNumber of this.cache.keys()) {
      if (!presentSerials.has(serialNumber)) this.cache.delete(serialNumber);
    }

    for (const serialNumber of onlineSerials) this.refreshInBackground(serialNumber);

    const observations = devices.map((device) => {
      const { model, androidVersion, batteryLevel, manufacturer, buildNumber } =
        this.cache.get(device.serialNumber) ?? {};
      return {
        serialNumber: device.serialNumber,
        state: mapAdbStatus(device.status),
        ...(model ? { model } : {}),
        ...(androidVersion ? { androidVersion } : {}),
        ...(batteryLevel !== undefined ? { batteryLevel } : {}),
        ...(manufacturer ? { manufacturer } : {}),
        ...(buildNumber ? { buildNumber } : {}),
      };
    });

    for (const serialNumber of this.previouslySeen) {
      if (!presentSerials.has(serialNumber)) {
        observations.push({ serialNumber, state: DeviceState.UNKNOWN });
      }
    }

    this.previouslySeen.clear();
    for (const serialNumber of presentSerials) this.previouslySeen.add(serialNumber);
    return observations;
  }

  async diagnose(serialNumber: string): Promise<DeviceDiagnostic> {
    const devices = parseAdbDevices(await this.execute(['devices']));
    const target = devices.find((device) => device.serialNumber === serialNumber);
    if (!target || target.status !== 'device') {
      throw new Error('El dispositivo no está conectado o no autorizó la depuración ADB.');
    }
    return readDeviceDiagnostics(serialNumber, this.execute);
  }

  async executeMaintenance(
    serialNumber: string,
    operation: MaintenanceOperation,
  ): Promise<void> {
    if (this.operationsInFlight.has(serialNumber)) {
      throw new Error('Ya hay una operación en curso para este dispositivo.');
    }
    this.operationsInFlight.add(serialNumber);
    try {
      const devices = parseAdbDevices(await this.execute(['devices']));
      const target = devices.find((device) => device.serialNumber === serialNumber);
      if (!target || target.status !== 'device') {
        throw new Error('El dispositivo no está conectado o no autorizó la depuración ADB.');
      }

      const manufacturer = await this.execute([
        '-s',
        serialNumber,
        'shell',
        'getprop',
        'ro.product.manufacturer',
      ]);
      if (manufacturer.trim().toLowerCase() !== 'samsung') {
        throw new Error('El fabricante Samsung no pudo verificarse mediante ADB.');
      }

      await this.execute([
        '-s',
        serialNumber,
        'reboot',
        ...(operation === 'REBOOT_RECOVERY' ? ['recovery'] : []),
      ]);
    } finally {
      this.operationsInFlight.delete(serialNumber);
    }
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
