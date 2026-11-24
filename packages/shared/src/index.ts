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

export enum UserRole {
  ADMIN = 'ADMIN',
  SUPERVISOR = 'SUPERVISOR',
  TECHNICIAN = 'TECHNICIAN',
}

const ModelSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((model) => model.toLowerCase() !== 'samsung device');

export const DeviceInfoSchema = z.object({
  serialNumber: z.string().trim().min(1),
  model: ModelSchema.nullable(),
  state: z.nativeEnum(DeviceState),
  androidVersion: z.string().trim().min(1).nullable().optional(),
  batteryLevel: z.number().int().min(0).max(100).nullable().optional(),
  buildNumber: z.string().optional(),
});

export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;

export const RegisterStationSchema = z.object({
  stationName: z.string().trim().min(1).max(128),
  token: z.string().min(32).max(512),
});

export const AgentDeviceStateSchema = z.enum([
  DeviceState.UNKNOWN,
  DeviceState.UNKNOWN_INTERFACE,
  DeviceState.RECOVERY,
  DeviceState.ANDROID_INIT,
]);
export type AgentDeviceState = z.infer<typeof AgentDeviceStateSchema>;

export const DeviceObservationSchema = z.object({
  serialNumber: z.string().trim().min(1).max(128),
  state: AgentDeviceStateSchema,
  model: ModelSchema.optional(),
  androidVersion: z.string().trim().min(1).max(64).optional(),
  batteryLevel: z.number().int().min(0).max(100).optional(),
});

export const DeviceStatusUpdateSchema = z
  .object({
    stationName: z.string().trim().min(1).max(128),
    devices: z.array(DeviceObservationSchema).max(256),
  })
  .superRefine(({ devices }, context) => {
    const serialNumbers = new Set<string>();
    devices.forEach((device, index) => {
      if (serialNumbers.has(device.serialNumber)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['devices', index, 'serialNumber'],
          message: 'A device serial number may appear only once per update.',
        });
      }
      serialNumbers.add(device.serialNumber);
    });
  });

export type DeviceObservation = z.infer<typeof DeviceObservationSchema>;
export type DeviceStatusUpdate = z.infer<typeof DeviceStatusUpdateSchema>;

export const LoginSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(1).max(128),
});

export const CreateUserSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(12).max(128),
  role: z.nativeEnum(UserRole).default(UserRole.TECHNICIAN),
});

export const UpdateUserSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((email) => email.toLowerCase())
      .optional(),
    name: z.string().trim().min(1).max(120).optional(),
    password: z.string().min(12).max(128).optional(),
    role: z.nativeEnum(UserRole).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided.',
  });

export type LoginInput = z.infer<typeof LoginSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

export function mapAdbStatus(status: string): AgentDeviceState {
  switch (status) {
    case 'device':
      return DeviceState.ANDROID_INIT;
    case 'recovery':
      return DeviceState.RECOVERY;
    case 'sideload':
    case 'unauthorized':
    case 'offline':
    case 'bootloader':
      return DeviceState.UNKNOWN_INTERFACE;
    default:
      return DeviceState.UNKNOWN;
  }
}
