import { z } from 'zod';

export enum DeviceState {
  OFF = 'OFF',
  UNKNOWN_INTERFACE = 'UNKNOWN_INTERFACE',
  RECOVERY = 'RECOVERY',
  DOWNLOAD_MODE = 'DOWNLOAD_MODE',
  ANDROID_INIT = 'ANDROID_INIT',
  INCOMPATIBLE = 'INCOMPATIBLE',
  UNKNOWN = 'UNKNOWN'
}

export const DeviceInfoSchema = z.object({
  serialNumber: z.string(),
  model: z.string(),
  state: z.nativeEnum(DeviceState),
  androidVersion: z.string().optional(),
  buildNumber: z.string().optional(),
});

export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;

