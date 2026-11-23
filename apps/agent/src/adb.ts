import { execFile } from 'node:child_process';

const ADB_TIMEOUT_MS = 5_000;

export interface AdbDevice {
  serialNumber: string;
  status: string;
}

export interface HardwareInfo {
  model?: string;
  androidVersion?: string;
  batteryLevel?: number;
}

export type AdbExecutor = (args: string[]) => Promise<string>;

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
): Promise<{ info: Pick<HardwareInfo, 'model' | 'androidVersion'>; errors: string[] }> {
  const errors: string[] = [];
  const [model, androidVersion] = await Promise.all([
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
  ]);

  return {
    info: {
      ...(typeof model === 'string' ? { model } : {}),
      ...(typeof androidVersion === 'string' ? { androidVersion } : {}),
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
