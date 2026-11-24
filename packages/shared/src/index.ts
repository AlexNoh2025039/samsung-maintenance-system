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
  manufacturer: z.string().trim().min(1).max(64).optional(),
  buildNumber: z.string().trim().min(1).max(128).optional(),
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

const NonNegativeIntegerSchema = z.number().int().nonnegative();

export const DeviceDiagnosticSchema = z.object({
  serialNumber: z.string().trim().min(1).max(128),
  collectedAt: z.string().datetime(),
  adbAuthorized: z.boolean(),
  properties: z.object({
    manufacturer: z.string().trim().min(1).max(64).optional(),
    model: ModelSchema.optional(),
    androidVersion: z.string().trim().min(1).max(64).optional(),
    buildNumber: z.string().trim().min(1).max(128).optional(),
  }),
  battery: z.object({
    level: z.number().int().min(0).max(100).optional(),
    temperatureCelsius: z.number().min(-20).max(120).optional(),
  }),
  storage: z.object({
    totalBytes: NonNegativeIntegerSchema.optional(),
    usedBytes: NonNegativeIntegerSchema.optional(),
    availableBytes: NonNegativeIntegerSchema.optional(),
  }),
  memory: z.object({
    totalBytes: NonNegativeIntegerSchema.optional(),
    availableBytes: NonNegativeIntegerSchema.optional(),
  }),
  connectivity: z.object({
    interfaces: z.array(z.object({
      name: z.string().trim().min(1).max(64),
      addresses: z.array(z.string().trim().min(1).max(64)).max(32),
    })).max(64),
    defaultRoutes: z.array(z.string().trim().min(1).max(256)).max(32),
  }),
  usbDebugging: z.boolean().nullable(),
  errors: z.array(z.string().trim().min(1).max(200)).max(32),
});

export type DeviceDiagnostic = z.infer<typeof DeviceDiagnosticSchema>;

export const DeviceDiagnosticRequestSchema = z.object({
  requestId: z.string().uuid(),
  serialNumber: z.string().trim().min(1).max(128),
});

export type DeviceDiagnosticRequest = z.infer<typeof DeviceDiagnosticRequestSchema>;

export const MaintenanceOperationSchema = z.enum(['REBOOT', 'REBOOT_RECOVERY']);
export type MaintenanceOperation = z.infer<typeof MaintenanceOperationSchema>;

export const MaintenanceOperationRequestSchema = z.object({
  requestId: z.string().uuid(),
  serialNumber: z.string().trim().min(1).max(128),
  operation: MaintenanceOperationSchema,
});
export type MaintenanceOperationRequest = z.infer<typeof MaintenanceOperationRequestSchema>;

export const ExecuteMaintenanceOperationSchema = z.object({
  operation: MaintenanceOperationSchema,
  confirmation: z.string().trim().min(1).max(256),
});

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

export const UpdateStationSchema = z
  .object({
    machineName: z.string().trim().min(1).max(128).optional(),
    ipAddress: z
      .string()
      .trim()
      .max(45)
      .refine((value) => value.length === 0 || /^[\da-fA-F:.]+$/.test(value), {
        message: 'A valid IPv4 or IPv6 address must be provided.',
      })
      .optional()
      .transform((value) => (value === '' ? null : value)),
    isRegistered: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one station field must be provided.',
  });

export type UpdateStationInput = z.infer<typeof UpdateStationSchema>;

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
