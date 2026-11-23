import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseAdbDevices,
  parseBatteryLevel,
  readBatteryLevel,
  readDeviceProperties,
} from './adb';

test('parseAdbDevices reads authorized and unavailable devices', () => {
  assert.deepEqual(
    parseAdbDevices(
      'List of devices attached\r\nABC123\tdevice product:foo\r\nDEF456 unauthorized\r\nGHI789 recovery\r\n',
    ),
    [
      { serialNumber: 'ABC123', status: 'device' },
      { serialNumber: 'DEF456', status: 'unauthorized' },
      { serialNumber: 'GHI789', status: 'recovery' },
    ],
  );
});

test('parseBatteryLevel accepts only integer percentages from 0 to 100', () => {
  assert.equal(parseBatteryLevel('Current Battery Service state:\n  level: 100\n'), 100);
  assert.equal(parseBatteryLevel('level: 0'), 0);
  assert.equal(parseBatteryLevel('level: 101'), undefined);
  assert.equal(parseBatteryLevel('level: -1'), undefined);
  assert.equal(parseBatteryLevel('status: 2'), undefined);
});

test('readDeviceProperties uses exec arguments and preserves an available property on partial failure', async () => {
  const commands: string[][] = [];
  const result = await readDeviceProperties('serial;not-a-shell-command', async (args) => {
    commands.push(args);
    if (args[4] === 'ro.product.model') throw new Error('device disconnected');
    return '  14 \n';
  });

  assert.deepEqual(result, {
    info: { androidVersion: '14' },
    errors: ['model: ADB command failed or timed out'],
  });
  assert.deepEqual(commands, [
    ['-s', 'serial;not-a-shell-command', 'shell', 'getprop', 'ro.product.model'],
    ['-s', 'serial;not-a-shell-command', 'shell', 'getprop', 'ro.build.version.release'],
  ]);
});

test('readDeviceProperties omits the old generic model fallback', async () => {
  const result = await readDeviceProperties('ABC123', async (args) =>
    args[4] === 'ro.product.model' ? 'Samsung Device' : '14',
  );

  assert.deepEqual(result.info, { androidVersion: '14' });
  assert.deepEqual(result.errors, ['model: empty or invalid response']);
});

test('readBatteryLevel leaves the value absent when ADB returns incomplete or invalid data', async () => {
  assert.deepEqual(
    await readBatteryLevel('ABC123', async () => 'AC powered: false\n'),
    { error: 'batteryLevel: empty or invalid response' },
  );
  assert.deepEqual(
    await readBatteryLevel('ABC123', async () => {
      throw new Error('adb not found');
    }),
    { error: 'batteryLevel: ADB command failed or timed out' },
  );
});
