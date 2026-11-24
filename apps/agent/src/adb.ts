import { execFile } from 'node:child_process';
import { DeviceDiagnostic } from '@samsung-maintenance/shared';

const ADB_TIMEOUT_MS = 5_000;

export interface AdbDevice {
  serialNumber: string;
  status: string;
}

export interface HardwareInfo {
  model?: string;
  androidVersion?: string;
  batteryLevel?: number;
  manufacturer?: string;
  buildNumber?: string;
}

export type AdbExecutor = (args: string[]) => Promise<string>;

export type DiagnosticSnapshot = Omit<DeviceDiagnostic, 'serialNumber' | 'collectedAt'>;

export const executeAdb: AdbExecutor = (args) =>
  new Promise((resolve, reject) => {
    execFile(
      'adb',
      args,
      {
        encoding: 'utf8',
        timeout: ADB_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(stdout);
      },
    );
  });

export function parseAdbDevices(output: string): AdbDevice[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices attached'))
    .flatMap((line) => {
      const [serialNumber, status] = line.split(/\s+/);
      return serialNumber && status ? [{ serialNumber, status }] : [];
    });
}

export function parseBatteryLevel(output: string): number | undefined {
  const match = output.match(/^\s*level:\s*(\d+)\s*$/m);
  if (!match) return undefined;

  const level = Number(match[1]);
  return Number.isInteger(level) && level >= 0 && level <= 100
    ? level
    : undefined;
}

function parseProperty(output: string): string | undefined {
  const value = output.trim();
  return value && value !== '(null)' && value.toLowerCase() !== 'samsung device'
    ? value
    : undefined;
}

async function readValue(
  args: string[],
  parse: (output: string) => string | number | undefined,
  fieldName: string,
  execute: AdbExecutor,
  errors: string[],
): Promise<string | number | undefined> {
  try {
    const value = parse(await execute(args));
    if (value === undefined) errors.push(`${fieldName}: empty or invalid response`);
    return value;
  } catch {
    errors.push(`${fieldName}: ADB command failed or timed out`);
    return undefined;
  }
}

export async function readDeviceProperties(
  serialNumber: string,
  execute: AdbExecutor = executeAdb,
): Promise<{
  info: Pick<HardwareInfo, 'model' | 'androidVersion' | 'manufacturer' | 'buildNumber'>;
  errors: string[];
}> {
  const errors: string[] = [];
  const [model, androidVersion, manufacturer, buildNumber] = await Promise.all([
    readValue(
      ['-s', serialNumber, 'shell', 'getprop', 'ro.product.model'],
      parseProperty,
      'model',
      execute,
      errors,
    ),
    readValue(
      ['-s', serialNumber, 'shell', 'getprop', 'ro.build.version.release'],
      parseProperty,
      'androidVersion',
      execute,
      errors,
    ),
    readValue(
      ['-s', serialNumber, 'shell', 'getprop', 'ro.product.manufacturer'],
      parseProperty,
      'manufacturer',
      execute,
      errors,
    ),
    readValue(
      ['-s', serialNumber, 'shell', 'getprop', 'ro.build.display.id'],
      parseProperty,
      'buildNumber',
      execute,
      errors,
    ),
  ]);

  return {
    info: {
      ...(typeof model === 'string' ? { model } : {}),
      ...(typeof androidVersion === 'string' ? { androidVersion } : {}),
      ...(typeof manufacturer === 'string' ? { manufacturer } : {}),
      ...(typeof buildNumber === 'string' ? { buildNumber } : {}),
    },
    errors,
  };
}

export async function readBatteryLevel(
  serialNumber: string,
  execute: AdbExecutor = executeAdb,
): Promise<{ batteryLevel?: number; error?: string }> {
  const errors: string[] = [];
  const batteryLevel = await readValue(
    ['-s', serialNumber, 'shell', 'dumpsys', 'battery'],
    parseBatteryLevel,
    'batteryLevel',
    execute,
    errors,
  );

  return {
    ...(typeof batteryLevel === 'number' ? { batteryLevel } : {}),
    ...(errors.length > 0 ? { error: errors[0] } : {}),
  };
}

export function parseMemoryInfo(output: string): {
  totalBytes?: number;
  availableBytes?: number;
} {
  const totalBytes = kilobytesToBytes(parseMemInfoValue(output, 'MemTotal'));
  const availableBytes = kilobytesToBytes(parseMemInfoValue(output, 'MemAvailable'));
  return {
    ...(totalBytes !== undefined ? { totalBytes } : {}),
    ...(availableBytes !== undefined ? { availableBytes } : {}),
  };
}

function kilobytesToBytes(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const bytes = value * 1024;
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}

function parseMemInfoValue(output: string, key: string): number | undefined {
  const match = output.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB\\s*$`, 'm'));
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function parseDataStorage(output: string): {
  totalBytes?: number;
  usedBytes?: number;
  availableBytes?: number;
} {
  const dataRow = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.endsWith(' /data'));
  if (!dataRow) return {};
  const fields = dataRow.split(/\s+/);
  const [totalKb, usedKb, availableKb] = fields.slice(1, 4).map(Number);
  if (
    ![totalKb, usedKb, availableKb].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    )
  ) return {};
  const [totalBytes, usedBytes, availableBytes] = [
    kilobytesToBytes(totalKb),
    kilobytesToBytes(usedKb),
    kilobytesToBytes(availableKb),
  ];
  if (
    totalBytes === undefined ||
    usedBytes === undefined ||
    availableBytes === undefined
  ) return {};
  return {
    totalBytes,
    usedBytes,
    availableBytes,
  };
}

export function parseConnectivity(output: string, routesOutput: string): {
  interfaces: Array<{ name: string; addresses: string[] }>;
  defaultRoutes: string[];
} {
  const interfaces = new Map<string, string[]>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\d+:\s+([^:@\s]+)(?:@[^:\s]+)?\s+.*?\binet6?\s+([^\s/]+)/);
    if (!match) continue;
    const addresses = interfaces.get(match[1]) ?? [];
    addresses.push(match[2]);
    interfaces.set(match[1], addresses);
  }
  const defaultRoutes = routesOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('default ') || line === 'default');
  return {
    interfaces: [...interfaces].map(([name, addresses]) => ({ name, addresses })),
    defaultRoutes,
  };
}

function parseUsbDebugging(output: string): boolean | null {
  const value = output.trim();
  if (value === '1') return true;
  if (value === '0') return false;
  return null;
}

export async function readDeviceDiagnostics(
  serialNumber: string,
  execute: AdbExecutor = executeAdb,
  now: () => Date = () => new Date(),
): Promise<DeviceDiagnostic> {
  const errors: string[] = [];
  const run = async (label: string, args: string[]): Promise<string> => {
    try {
      return await execute(['-s', serialNumber, ...args]);
    } catch {
      errors.push(`${label}: ADB command failed or timed out`);
      return '';
    }
  };
  const [
    propertyResults,
    batteryOutput,
    storageOutput,
    memoryOutput,
    ipOutput,
    routesOutput,
    ipv6RoutesOutput,
    debugOutput,
  ] =
    await Promise.all([
      Promise.all([
        run('manufacturer', ['shell', 'getprop', 'ro.product.manufacturer']),
        run('model', ['shell', 'getprop', 'ro.product.model']),
        run('androidVersion', ['shell', 'getprop', 'ro.build.version.release']),
        run('buildNumber', ['shell', 'getprop', 'ro.build.display.id']),
      ]),
      run('battery', ['shell', 'dumpsys', 'battery']),
      run('storage', ['shell', 'df', '-k', '/data']),
      run('memory', ['shell', 'cat', '/proc/meminfo']),
      run('connectivity.interfaces', ['shell', 'ip', '-o', 'addr', 'show']),
      run('connectivity.routes', ['shell', 'ip', 'route', 'show', 'default']),
      run('connectivity.ipv6Routes', ['shell', 'ip', '-6', 'route', 'show', 'default']),
      run('usbDebugging', ['shell', 'settings', 'get', 'global', 'adb_enabled']),
    ]);

  const [manufacturer, model, androidVersion, buildNumber] = propertyResults.map(parseProperty);
  const level = parseBatteryLevel(batteryOutput);
  const temperatureMatch = batteryOutput.match(/^\s*temperature:\s*(-?\d+)\s*$/m);
  const temperatureTenths = temperatureMatch ? Number(temperatureMatch[1]) : NaN;
  const temperatureCelsius =
    Number.isInteger(temperatureTenths) && temperatureTenths >= -200 && temperatureTenths <= 1200
      ? temperatureTenths / 10
      : undefined;

  const parsedStorage = parseDataStorage(storageOutput);
  const parsedMemory = parseMemoryInfo(memoryOutput);
  const connectivity = parseConnectivity(ipOutput, `${routesOutput}\n${ipv6RoutesOutput}`);
  if (level === undefined) errors.push('battery.level: value unavailable or invalid');
  if (temperatureCelsius === undefined) errors.push('battery.temperature: value unavailable or invalid');
  if (parsedStorage.totalBytes === undefined) errors.push('storage: /data usage unavailable or invalid');
  if (parsedMemory.totalBytes === undefined) errors.push('memory: MemTotal unavailable or invalid');
  if (parsedMemory.availableBytes === undefined) errors.push('memory: MemAvailable unavailable or invalid');
  if (!manufacturer) errors.push('manufacturer: value unavailable or invalid');
  if (!model) errors.push('model: value unavailable or invalid');
  if (!androidVersion) errors.push('androidVersion: value unavailable or invalid');
  if (!buildNumber) errors.push('buildNumber: value unavailable or invalid');
  if (connectivity.interfaces.length === 0) errors.push('connectivity: interface addresses unavailable');
  const usbDebugging = parseUsbDebugging(debugOutput);
  if (usbDebugging === null) errors.push('usbDebugging: setting unavailable or invalid');

  return {
    adbAuthorized: true,
    properties: {
      ...(manufacturer ? { manufacturer } : {}),
      ...(model ? { model } : {}),
      ...(androidVersion ? { androidVersion } : {}),
      ...(buildNumber ? { buildNumber } : {}),
    },
    battery: {
      ...(level !== undefined ? { level } : {}),
      ...(temperatureCelsius !== undefined ? { temperatureCelsius } : {}),
    },
    storage: parsedStorage,
    memory: parsedMemory,
    connectivity,
    usbDebugging,
    errors: errors.slice(0, 32),
    serialNumber,
    collectedAt: now().toISOString(),
  };
}
