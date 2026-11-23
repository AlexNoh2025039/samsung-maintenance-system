import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceStateEnum as PrismaDeviceState } from '@prisma/client';
import {
  DeviceObservation,
  DeviceState,
  DeviceStatusUpdateSchema,
  mapAdbStatus,
} from '@samsung-maintenance/shared';
import {
  DeviceSnapshot,
  DeviceSyncStore,
  syncDeviceBatch,
  syncDeviceObservation,
} from './device-sync';

function createStore(options: { failSerial?: string } = {}) {
  const records = new Map<string, DeviceSnapshot>();
  const upsertCalls: string[] = [];
  const store: DeviceSyncStore = {
    device: {
      async findUnique({ where }) {
        if (where.serialNumber === options.failSerial) {
          throw new Error('database unavailable');
        }
        return records.get(where.serialNumber) ?? null;
      },
      async upsert(args) {
        if (args.where.serialNumber === options.failSerial) {
          throw new Error('database unavailable');
        }
        upsertCalls.push(args.where.serialNumber);
        const previous = records.get(args.where.serialNumber);
        const { serialNumber: _serialNumber, ...createSnapshot } = args.create;
        records.set(args.where.serialNumber, {
          ...(previous ?? createSnapshot),
          ...args.update,
        });
      },
    },
  };

  return { store, records, upsertCalls };
}

function observation(
  serialNumber: string,
  overrides: Partial<DeviceObservation> = {},
): DeviceObservation {
  return {
    serialNumber,
    state: DeviceState.ANDROID_INIT,
    model: 'SM-S918B',
    androidVersion: '14',
    batteryLevel: 82,
    ...overrides,
  };
}

test('ADB statuses never claim Download Mode without evidence', () => {
  assert.equal(mapAdbStatus('device'), DeviceState.ANDROID_INIT);
  assert.equal(mapAdbStatus('recovery'), DeviceState.RECOVERY);
  assert.equal(mapAdbStatus('sideload'), DeviceState.UNKNOWN_INTERFACE);
  assert.equal(mapAdbStatus('bootloader'), DeviceState.UNKNOWN_INTERFACE);
  assert.equal(mapAdbStatus('unrecognized'), DeviceState.UNKNOWN);
});

test('device status validation rejects out-of-range battery values and Download Mode claims', () => {
  const base = {
    stationName: 'WORKSTATION',
    devices: [observation('ABC123')],
  };
  assert.equal(DeviceStatusUpdateSchema.safeParse(base).success, true);
  assert.equal(
    DeviceStatusUpdateSchema.safeParse({
      ...base,
      devices: [{ ...base.devices[0], batteryLevel: 101 }],
    }).success,
    false,
  );
  assert.equal(
    DeviceStatusUpdateSchema.safeParse({
      ...base,
      devices: [{ ...base.devices[0], state: DeviceState.DOWNLOAD_MODE }],
    }).success,
    false,
  );
  assert.equal(
    DeviceStatusUpdateSchema.safeParse({
      ...base,
      devices: [{ ...base.devices[0], model: 'Samsung Device' }],
    }).success,
    false,
  );
});

test('new devices are created with missing hardware values as null, not generic values', async () => {
  const { store, records, upsertCalls } = createStore();
  await syncDeviceObservation(
    store,
    'station-1',
    observation('ABC123', {
      model: undefined,
      androidVersion: undefined,
      batteryLevel: undefined,
    }),
  );

  assert.deepEqual(records.get('ABC123'), {
    model: null,
    androidVersion: null,
    batteryLevel: null,
    state: PrismaDeviceState.ANDROID_INIT,
    stationId: 'station-1',
  });
  assert.deepEqual(upsertCalls, ['ABC123']);
});

test('repeated unchanged events do not issue unnecessary upserts', async () => {
  const { store, upsertCalls } = createStore();
  await syncDeviceObservation(store, 'station-1', observation('ABC123'));
  const changed = await syncDeviceObservation(store, 'station-1', observation('ABC123'));

  assert.equal(changed, false);
  assert.deepEqual(upsertCalls, ['ABC123']);
});

test('missing hardware readings preserve the last valid database values', async () => {
  const { store, records } = createStore();
  await syncDeviceObservation(store, 'station-1', observation('ABC123'));
  await syncDeviceObservation(
    store,
    'station-1',
    observation('ABC123', {
      model: undefined,
      androidVersion: undefined,
      batteryLevel: undefined,
    }),
  );

  assert.deepEqual(records.get('ABC123'), {
    model: 'SM-S918B',
    androidVersion: '14',
    batteryLevel: 82,
    state: PrismaDeviceState.ANDROID_INIT,
    stationId: 'station-1',
  });
});

test('the legacy generic model placeholder is cleared when no valid model is reported', async () => {
  const { store, records } = createStore();
  records.set('ABC123', {
    model: 'Samsung Device',
    androidVersion: '14',
    batteryLevel: 82,
    state: PrismaDeviceState.ANDROID_INIT,
    stationId: 'station-1',
  });

  await syncDeviceObservation(
    store,
    'station-1',
    observation('ABC123', { model: undefined }),
  );

  assert.equal(records.get('ABC123')?.model, null);
});

test('a later authenticated station report reassigns the globally unique serial', async () => {
  const { store, records, upsertCalls } = createStore();
  await syncDeviceObservation(store, 'station-1', observation('ABC123'));
  await syncDeviceObservation(
    store,
    'station-2',
    observation('ABC123', { batteryLevel: 80 }),
  );

  assert.equal(records.get('ABC123')?.stationId, 'station-2');
  assert.deepEqual(upsertCalls, ['ABC123', 'ABC123']);
});

test('a database failure for one device does not interrupt the rest of the batch', async () => {
  const { store, upsertCalls } = createStore({ failSerial: 'BAD' });
  const loggedErrors: string[] = [];
  const result = await syncDeviceBatch(
    store,
    'station-1',
    [observation('BAD'), observation('GOOD')],
    { error: (message) => loggedErrors.push(message) },
  );

  assert.deepEqual(result, { updated: 1, failed: 1 });
  assert.deepEqual(upsertCalls, ['GOOD']);
  assert.equal(loggedErrors.length, 1);
});

test('two devices in one batch are both persisted independently', async () => {
  const { store, records } = createStore();
  const result = await syncDeviceBatch(store, 'station-1', [
    observation('PHONE-1'),
    observation('PHONE-2', { model: 'SM-A546B' }),
  ]);

  assert.deepEqual(result, { updated: 2, failed: 0 });
  assert.equal(records.size, 2);
});
