import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceState } from '@samsung-maintenance/shared';
import { DeviceMonitor } from './device-monitor';

function flushBackgroundWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('DeviceMonitor reads hardware only for authorized devices and maps sideload conservatively', async () => {
  const commands: string[][] = [];
  const errors: string[] = [];
  const monitor = new DeviceMonitor(
    async (args) => {
      commands.push(args);
      if (args[0] === 'devices') {
        return [
          'List of devices attached',
          'PHONE device',
          'LOCKED unauthorized',
          'RECOVERY recovery',
          'SIDELOAD sideload',
        ].join('\n');
      }
      if (args[3] === 'getprop' && args[4] === 'ro.product.model') return 'SM-S918B\n';
      if (args[3] === 'getprop') return '14\n';
      if (args[3] === 'dumpsys') return 'level: 82\n';
      throw new Error('Unexpected command');
    },
    { error: (message) => errors.push(message) },
  );

  const firstScan = await monitor.scan();
  await flushBackgroundWork();
  const secondScan = await monitor.scan();

  assert.deepEqual(
    secondScan.map(({ serialNumber, state }) => [serialNumber, state]),
    [
      ['PHONE', DeviceState.ANDROID_INIT],
      ['LOCKED', DeviceState.UNKNOWN_INTERFACE],
      ['RECOVERY', DeviceState.RECOVERY],
      ['SIDELOAD', DeviceState.UNKNOWN_INTERFACE],
    ],
  );
  assert.deepEqual(
    secondScan[0],
    {
      serialNumber: 'PHONE',
      state: DeviceState.ANDROID_INIT,
      model: 'SM-S918B',
      androidVersion: '14',
      batteryLevel: 82,
    },
  );
  assert.equal(firstScan[0].model, undefined);
  assert.equal(commands.filter((args) => args[0] !== 'devices').length, 3);
  assert.equal(errors.length, 0);
});

test('DeviceMonitor does not duplicate in-flight reads for the same serial', async () => {
  let releaseReads!: () => void;
  const readGate = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  const commands: string[][] = [];
  const monitor = new DeviceMonitor(async (args) => {
    if (args[0] === 'devices') return 'List of devices attached\nPHONE device\n';
    commands.push(args);
    await readGate;
    return args[3] === 'dumpsys' ? 'level: 50' : 'SM-G991B';
  });

  await monitor.scan();
  await monitor.scan();
  assert.equal(commands.length, 2);

  releaseReads();
  await flushBackgroundWork();
  assert.equal(commands.length, 3);
  await monitor.scan();
  assert.equal(commands.length, 3);
});

test('one device failure does not prevent hardware collection for another device', async () => {
  const errors: string[] = [];
  const monitor = new DeviceMonitor(
    async (args) => {
      if (args[0] === 'devices') {
        return 'List of devices attached\nGOOD device\nBAD device\n';
      }
      if (args[1] === 'BAD') throw new Error('device disconnected');
      if (args[3] === 'getprop' && args[4] === 'ro.product.model') return 'SM-A546B';
      if (args[3] === 'getprop') return '';
      return 'level: 999';
    },
    { error: (message) => errors.push(message) },
  );

  await monitor.scan();
  await flushBackgroundWork();
  const devices = await monitor.scan();

  assert.equal(devices.find((device) => device.serialNumber === 'GOOD')?.model, 'SM-A546B');
  assert.equal(devices.find((device) => device.serialNumber === 'GOOD')?.batteryLevel, undefined);
  assert.equal(devices.find((device) => device.serialNumber === 'BAD')?.model, undefined);
  assert.ok(errors.length > 0);
});

test('ADB unavailable errors are surfaced to the caller for retry on the next scan', async () => {
  const monitor = new DeviceMonitor(async () => {
    throw new Error('adb not found');
  });

  await assert.rejects(monitor.scan(), /adb not found/);
});
