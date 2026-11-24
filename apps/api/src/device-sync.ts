import { DeviceStateEnum as PrismaDeviceState } from '@prisma/client';
import {
  AgentDeviceState,
  DeviceObservation,
  DeviceState,
} from '@samsung-maintenance/shared';

export interface DeviceSnapshot {
  model: string | null;
  manufacturer: string | null;
  buildNumber: string | null;
  androidVersion: string | null;
  batteryLevel: number | null;
  state: PrismaDeviceState;
  stationId: string | null;
}

export interface DeviceSyncStore {
  device: {
    findUnique(args: {
      where: { serialNumber: string };
      select: {
        model: true;
        manufacturer: true;
        buildNumber: true;
        androidVersion: true;
        batteryLevel: true;
        state: true;
        stationId: true;
      };
    }): Promise<DeviceSnapshot | null>;
    upsert(args: {
      where: { serialNumber: string };
      create: {
        serialNumber: string;
        model: string | null;
        manufacturer: string | null;
        buildNumber: string | null;
        androidVersion: string | null;
        batteryLevel: number | null;
        state: PrismaDeviceState;
        stationId: string;
      };
      update: {
        model?: string | null;
        manufacturer?: string | null;
        buildNumber?: string | null;
        androidVersion?: string;
        batteryLevel?: number;
        state: PrismaDeviceState;
        stationId: string;
      };
    }): Promise<unknown>;
  };
}

export interface SyncLogger {
  error(message: string, error: unknown): void;
}

const stateMap: Record<AgentDeviceState, PrismaDeviceState> = {
  [DeviceState.UNKNOWN]: PrismaDeviceState.UNKNOWN,
  [DeviceState.UNKNOWN_INTERFACE]: PrismaDeviceState.UNKNOWN_INTERFACE,
  [DeviceState.RECOVERY]: PrismaDeviceState.RECOVERY,
  [DeviceState.ANDROID_INIT]: PrismaDeviceState.ANDROID_INIT,
};

function isUnchanged(
  existing: DeviceSnapshot,
  stationId: string,
  observation: DeviceObservation,
  state: PrismaDeviceState,
): boolean {
  return (
    existing.state === state &&
    existing.stationId === stationId &&
    (existing.model !== 'Samsung Device' || observation.model !== undefined) &&
    (observation.model === undefined || existing.model === observation.model) &&
    (observation.manufacturer === undefined ||
      existing.manufacturer === observation.manufacturer) &&
    (observation.buildNumber === undefined ||
      existing.buildNumber === observation.buildNumber) &&
    (observation.androidVersion === undefined ||
      existing.androidVersion === observation.androidVersion) &&
    (observation.batteryLevel === undefined ||
      existing.batteryLevel === observation.batteryLevel)
  );
}

export async function syncDeviceObservation(
  store: DeviceSyncStore,
  stationId: string,
  observation: DeviceObservation,
): Promise<boolean> {
  const state = stateMap[observation.state];
  const existing = await store.device.findUnique({
    where: { serialNumber: observation.serialNumber },
    select: {
      model: true,
      manufacturer: true,
      buildNumber: true,
      androidVersion: true,
      batteryLevel: true,
      state: true,
      stationId: true,
    },
  });

  if (existing && isUnchanged(existing, stationId, observation, state)) return false;

  await store.device.upsert({
    where: { serialNumber: observation.serialNumber },
    create: {
      serialNumber: observation.serialNumber,
      model: observation.model ?? null,
      manufacturer: observation.manufacturer ?? null,
      buildNumber: observation.buildNumber ?? null,
      androidVersion: observation.androidVersion ?? null,
      batteryLevel: observation.batteryLevel ?? null,
      state,
      stationId,
    },
    update: {
      ...(observation.model !== undefined ? { model: observation.model } : {}),
      ...(observation.manufacturer !== undefined
        ? { manufacturer: observation.manufacturer }
        : {}),
      ...(observation.buildNumber !== undefined
        ? { buildNumber: observation.buildNumber }
        : {}),
      ...(observation.model === undefined && existing?.model === 'Samsung Device'
        ? { model: null }
        : {}),
      ...(observation.androidVersion !== undefined
        ? { androidVersion: observation.androidVersion }
        : {}),
      ...(observation.batteryLevel !== undefined
        ? { batteryLevel: observation.batteryLevel }
        : {}),
      state,
      stationId,
    },
  });

  return true;
}

export async function syncDeviceBatch(
  store: DeviceSyncStore,
  stationId: string,
  devices: DeviceObservation[],
  logger: SyncLogger = console,
): Promise<{ updated: number; failed: number }> {
  let updated = 0;
  let failed = 0;

  for (const device of devices) {
    try {
      if (await syncDeviceObservation(store, stationId, device)) updated += 1;
    } catch (error) {
      failed += 1;
      logger.error(
        `No se pudo guardar el dispositivo ${device.serialNumber}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { updated, failed };
}
