import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseAdbDevices,
  parseBatteryLevel,
  parseConnectivity,
  parseDataStorage,
  parseMemoryInfo,
  readBatteryLevel,
  readDeviceDiagnostics,
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
    info: { androidVersion: '14', manufacturer: '14', buildNumber: '14' },
    errors: ['model: ADB command failed or timed out'],
  });
  assert.deepEqual(commands, [
    ['-s', 'serial;not-a-shell-command', 'shell', 'getprop', 'ro.product.model'],
    ['-s', 'serial;not-a-shell-command', 'shell', 'getprop', 'ro.build.version.release'],
    ['-s', 'serial;not-a-shell-command', 'shell', 'getprop', 'ro.product.manufacturer'],
    ['-s', 'serial;not-a-shell-command', 'shell', 'getprop', 'ro.build.display.id'],
  ]);
});

test('readDeviceProperties omits the old generic model fallback', async () => {
  const result = await readDeviceProperties('ABC123', async (args) =>
    args[4] === 'ro.product.model' ? 'Samsung Device' : '14',
  );

  assert.deepEqual(result.info, {
    androidVersion: '14',
    manufacturer: '14',
    buildNumber: '14',
  });
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

test('diagnostic parsers report available storage, memory, and network information', () => {
  assert.deepEqual(parseDataStorage(
    'Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/block/dm-1 1000 300 700 30% /data\n',
  ), {
    totalBytes: 1_024_000,
    usedBytes: 307_200,
    availableBytes: 716_800,
  });
  assert.deepEqual(parseMemoryInfo('MemTotal: 4096 kB\nMemAvailable: 2048 kB\n'), {
    totalBytes: 4_194_304,
    availableBytes: 2_097_152,
  });
  assert.deepEqual(parseConnectivity(
    '2: wlan0    inet 192.0.2.10/24 brd 192.0.2.255 scope global wlan0\n',
    'default via 192.0.2.1 dev wlan0\n',
  ), {
    interfaces: [{ name: 'wlan0', addresses: ['192.0.2.10'] }],
    defaultRoutes: ['default via 192.0.2.1 dev wlan0'],
  });
});

test('readDeviceDiagnostics uses read-only ADB calls and records partial data without inventing values', async () => {
  const commands: string[][] = [];
  const result = await readDeviceDiagnostics('ABC123', async (args) => {
    commands.push(args);
    const command = args.slice(3).join(' ');
    switch (command) {
      case 'getprop ro.product.manufacturer': return 'samsung';
      case 'getprop ro.product.model': return 'SM-S918B';
      case 'getprop ro.build.version.release': return '14';
      case 'getprop ro.build.display.id': return 'TP1A';
      case 'dumpsys battery': return 'level: 78\ntemperature: 312\n';
      case 'df -k /data': return '/dev/block/dm-1 1000 300 700 30% /data\n';
      case 'cat /proc/meminfo': return 'MemTotal: 4096 kB\nMemAvailable: 2048 kB\n';
      case 'ip -o addr show': return '2: wlan0 inet 192.0.2.10/24 scope global wlan0\n';
      case 'ip route show default': return 'default via 192.0.2.1 dev wlan0\n';
      case 'ip -6 route show default': return '';
      case 'settings get global adb_enabled': return '1\n';
      default: throw new Error(`Unexpected command ${command}`);
    }
  }, () => new Date('2026-11-24T18:00:00.000Z'));

  assert.equal(result.serialNumber, 'ABC123');
  assert.equal(result.adbAuthorized, true);
  assert.equal(result.battery.temperatureCelsius, 31.2);
  assert.equal(result.usbDebugging, true);
  assert.deepEqual(result.errors, []);
  assert.ok(commands.every((args) => args[0] === '-s' && args[2] === 'shell'));
});
