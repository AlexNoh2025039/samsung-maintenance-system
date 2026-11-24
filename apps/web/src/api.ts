import type {
  CreateUserInput,
  UpdateStationInput,
  UpdateUserInput,
  MaintenanceOperation,
  UserRole,
} from '@samsung-maintenance/shared';
import type {
  AdminSession,
  AuditEntry,
  DashboardSummary,
  AuthenticatedUser,
  Device,
  Station,
  UserListItem,
  DeviceDiagnosticRecord,
  MaintenanceRecord,
} from './types';
import { DeviceDiagnosticSchema } from '@samsung-maintenance/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface LoginResponse {
  token: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUserRole(value: unknown): value is UserRole {
  return value === 'ADMIN' || value === 'SUPERVISOR' || value === 'TECHNICIAN';
}

function parseUser(value: unknown): AuthenticatedUser {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.email !== 'string' ||
    typeof value.name !== 'string' ||
    !isUserRole(value.role) ||
    typeof value.isActive !== 'boolean' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new Error('La API devolvió un usuario con un formato inválido.');
  }
  return {
    id: value.id,
    email: value.email,
    name: value.name,
    role: value.role,
    isActive: value.isActive,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseStation(value: unknown): Station {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.machineName !== 'string' ||
    typeof value.isRegistered !== 'boolean' ||
    typeof value.createdAt !== 'string'
  ) {
    throw new Error('La API devolvió una estación con un formato inválido.');
  }
  const devices: Array<{ id: string }> = [];
  if (value.devices !== undefined) {
    if (!Array.isArray(value.devices)) {
      throw new Error('La API devolvió una estación con dispositivos inválidos.');
    }
    for (const device of value.devices) {
      if (!isRecord(device) || typeof device.id !== 'string') {
        throw new Error('La API devolvió una estación con dispositivos inválidos.');
      }
      devices.push({ id: device.id });
    }
  }
  return {
    id: value.id,
    name: value.name,
    machineName: value.machineName,
    ipAddress:
      value.ipAddress === null || typeof value.ipAddress === 'string'
        ? value.ipAddress
        : null,
    isRegistered: value.isRegistered,
    createdAt: value.createdAt,
    ...(value.devices !== undefined ? { devices } : {}),
  };
}

function parseAdminSession(value: unknown): AdminSession {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.expiresAt !== 'string' ||
    !(value.revokedAt === null || typeof value.revokedAt === 'string') ||
    !isRecord(value.user)
  ) {
    throw new Error('La API devolvió una sesión con un formato inválido.');
  }
  const user = parseUser({
    ...value.user,
    createdAt: '',
    updatedAt: '',
  });
  return {
    id: value.id,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    revokedAt: value.revokedAt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
    },
  };
}

function parseDevice(value: unknown): Device {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.serialNumber !== 'string' ||
    !(value.model === null || typeof value.model === 'string') ||
    !(value.manufacturer === null || typeof value.manufacturer === 'string') ||
    !(value.buildNumber === null || typeof value.buildNumber === 'string') ||
    typeof value.state !== 'string' ||
    !(value.androidVersion === null || typeof value.androidVersion === 'string') ||
    !(value.batteryLevel === null || typeof value.batteryLevel === 'number')
  ) {
    throw new Error('La API devolvió un dispositivo con un formato inválido.');
  }
  return {
    id: value.id,
    serialNumber: value.serialNumber,
    model: value.model,
    manufacturer: value.manufacturer ?? null,
    buildNumber: value.buildNumber ?? null,
    state: value.state,
    androidVersion: value.androidVersion,
    batteryLevel: value.batteryLevel,
    ...(isRecord(value.station) ? { station: parseStation(value.station) } : {}),
  };
}

function parseDeviceDiagnostic(value: unknown): DeviceDiagnosticRecord {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !isDiagnosticStatus(value.status) ||
    !(value.result === null || DeviceDiagnosticSchema.safeParse(value.result).success) ||
    !Array.isArray(value.errors) ||
    !value.errors.every((error) => typeof error === 'string') ||
    typeof value.createdAt !== 'string' ||
    !(value.completedAt === null || typeof value.completedAt === 'string') ||
    !isRecord(value.user) ||
    typeof value.user.id !== 'string' ||
    typeof value.user.name !== 'string' ||
    typeof value.user.email !== 'string'
  ) {
    throw new Error('La API devolvió un diagnóstico con un formato inválido.');
  }
  const parsedResult = value.result === null
    ? null
    : DeviceDiagnosticSchema.parse(value.result);
  return {
    id: value.id,
    status: value.status,
    result: parsedResult,
    errors: value.errors,
    createdAt: value.createdAt,
    completedAt: value.completedAt,
    user: {
      id: value.user.id,
      name: value.user.name,
      email: value.user.email,
    },
  };
}

function parseMaintenanceRecord(value: unknown): MaintenanceRecord {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.type !== 'string' ||
    typeof value.status !== 'string' ||
    !(value.details === null || typeof value.details === 'string') ||
    typeof value.createdAt !== 'string' ||
    !isRecord(value.user) ||
    typeof value.user.id !== 'string' ||
    typeof value.user.name !== 'string' ||
    typeof value.user.email !== 'string' ||
    !isUserRole(value.user.role)
  ) {
    throw new Error('La API devolvió una operación con un formato inválido.');
  }
  return {
    id: value.id,
    type: value.type,
    status: value.status,
    details: value.details,
    createdAt: value.createdAt,
    user: {
      id: value.user.id,
      name: value.user.name,
      email: value.user.email,
      role: value.user.role,
    },
  };
}

function isDiagnosticStatus(value: unknown): value is DeviceDiagnosticRecord['status'] {
  return value === 'PENDING' || value === 'SUCCESS' || value === 'PARTIAL' || value === 'FAILED';
}

function parseAuditEntry(value: unknown): AuditEntry {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.action !== 'string' ||
    typeof value.target !== 'string' ||
    !(value.details === null || typeof value.details === 'string') ||
    typeof value.createdAt !== 'string' ||
    !isRecord(value.user)
  ) {
    throw new Error('La API devolvió un registro de auditoría con un formato inválido.');
  }
  const user = parseUser({
    ...value.user,
    isActive: true,
    createdAt: '',
    updatedAt: '',
  });
  return {
    id: value.id,
    action: value.action,
    target: value.target,
    details: value.details,
    createdAt: value.createdAt,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error('La API devolvió una respuesta inválida.');
  }
}

export function createApiClient(
  baseUrl = '',
  fetcher: typeof fetch = fetch,
) {
  const request = async (
    path: string,
    init?: RequestInit,
    token?: string,
  ): Promise<Response> => {
    const response = await fetcher(`${baseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });

    if (!response.ok) {
      let message = `La solicitud falló (${response.status}).`;
      try {
        const body: unknown = await response.json();
        if (isRecord(body) && typeof body.error === 'string') {
          message = body.error;
        }
      } catch {
        // Keep the generic HTTP message when an error response has no JSON body.
      }
      throw new ApiError(message, response.status);
    }

    return response;
  };

  return {
    async login(email: string, password: string): Promise<LoginResponse> {
      const response = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const body: unknown = await readJson(response);
      if (!isRecord(body) || typeof body.token !== 'string' || !body.token) {
        throw new Error('La API devolvió una respuesta de inicio de sesión inválida.');
      }
      return { token: body.token };
    },

    async me(token: string): Promise<AuthenticatedUser> {
      const response = await request('/api/auth/me', undefined, token);
      const body: unknown = await readJson(response);
      if (!isRecord(body)) throw new Error('La API devolvió una respuesta inválida.');
      return parseUser(body.user);
    },

    async logout(token: string): Promise<void> {
      await request('/api/auth/logout', { method: 'POST' }, token);
    },

    async stations(token: string): Promise<Station[]> {
      const response = await request('/api/stations', undefined, token);
      const body: unknown = await readJson(response);
      if (!Array.isArray(body)) throw new Error('La API devolvió una lista de estaciones inválida.');
      return body.map(parseStation);
    },

    async devices(token: string): Promise<Device[]> {
      const response = await request('/api/devices', undefined, token);
      const body: unknown = await readJson(response);
      if (!Array.isArray(body)) throw new Error('La API devolvió una lista de dispositivos inválida.');
      return body.map(parseDevice);
    },

    async runDiagnostic(token: string, deviceId: string): Promise<DeviceDiagnosticRecord> {
      const response = await request(
        `/api/devices/${encodeURIComponent(deviceId)}/diagnostics`,
        { method: 'POST' },
        token,
      );
      const body: unknown = await readJson(response);
      if (!isRecord(body)) throw new Error('La API devolvió una respuesta inválida.');
      return parseDeviceDiagnostic(body.diagnostic);
    },

    async diagnosticHistory(
      token: string,
      deviceId: string,
    ): Promise<DeviceDiagnosticRecord[]> {
      const response = await request(
        `/api/devices/${encodeURIComponent(deviceId)}/diagnostics`,
        undefined,
        token,
      );
      const body: unknown = await readJson(response);
      if (!isRecord(body) || !Array.isArray(body.diagnostics)) {
        throw new Error('La API devolvió un historial de diagnósticos inválido.');
      }
      return body.diagnostics.map(parseDeviceDiagnostic);
    },

    async runMaintenanceOperation(
      token: string,
      deviceId: string,
      operation: MaintenanceOperation,
      confirmation: string,
    ): Promise<MaintenanceRecord> {
      const response = await request(
        `/api/devices/${encodeURIComponent(deviceId)}/operations`,
        {
          method: 'POST',
          body: JSON.stringify({ operation, confirmation }),
        },
        token,
      );
      const body: unknown = await readJson(response);
      if (!isRecord(body)) throw new Error('La API devolvió una respuesta inválida.');
      return parseMaintenanceRecord(body.operation);
    },

    async operationHistory(token: string, deviceId: string): Promise<MaintenanceRecord[]> {
      const response = await request(
        `/api/devices/${encodeURIComponent(deviceId)}/operations`,
        undefined,
        token,
      );
      const body: unknown = await readJson(response);
      if (!isRecord(body) || !Array.isArray(body.operations)) {
        throw new Error('La API devolvió un historial de operaciones inválido.');
      }
      return body.operations.map(parseMaintenanceRecord);
    },

    async users(token: string): Promise<UserListItem[]> {
      const response = await request('/api/users', undefined, token);
      const body: unknown = await readJson(response);
      if (!isRecord(body) || !Array.isArray(body.users)) {
        throw new Error('La API devolvió una lista de usuarios inválida.');
      }
      return body.users.map(parseUser);
    },

    async updateStation(
      token: string,
      id: string,
      input: UpdateStationInput,
    ): Promise<Station> {
      const response = await request(`/api/admin/stations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }, token);
      const body: unknown = await readJson(response);
      if (!isRecord(body)) throw new Error('La API devolvió una respuesta inválida.');
      return parseStation(body.station);
    },

    async createUser(
      token: string,
      input: CreateUserInput,
    ): Promise<AuthenticatedUser> {
      const response = await request('/api/users', {
        method: 'POST',
        body: JSON.stringify(input),
      }, token);
      const body: unknown = await readJson(response);
      if (!isRecord(body)) throw new Error('La API devolvió una respuesta inválida.');
      return parseUser(body.user);
    },

    async updateUser(
      token: string,
      id: string,
      input: UpdateUserInput,
    ): Promise<AuthenticatedUser> {
      const response = await request(`/api/users/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }, token);
      const body: unknown = await readJson(response);
      if (!isRecord(body)) throw new Error('La API devolvió una respuesta inválida.');
      return parseUser(body.user);
    },

    async dashboardSummary(token: string): Promise<DashboardSummary> {
      const response = await request('/api/admin/dashboard', undefined, token);
      const body: unknown = await readJson(response);
      if (
        !isRecord(body) ||
        !isRecord(body.summary) ||
        !Object.values(body.summary).every((value) => typeof value === 'number')
      ) {
        throw new Error('La API devolvió un resumen con un formato inválido.');
      }
      return body.summary as unknown as DashboardSummary;
    },

    async adminSessions(token: string): Promise<AdminSession[]> {
      const response = await request('/api/admin/sessions', undefined, token);
      const body: unknown = await readJson(response);
      if (!isRecord(body) || !Array.isArray(body.sessions)) {
        throw new Error('La API devolvió una lista de sesiones inválida.');
      }
      return body.sessions.map(parseAdminSession);
    },

    async revokeSession(token: string, id: string): Promise<void> {
      await request(`/api/admin/sessions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }, token);
    },

    async auditEntries(token: string): Promise<AuditEntry[]> {
      const response = await request('/api/admin/audit', undefined, token);
      const body: unknown = await readJson(response);
      if (!isRecord(body) || !Array.isArray(body.entries)) {
        throw new Error('La API devolvió una lista de auditoría inválida.');
      }
      return body.entries.map(parseAuditEntry);
    },
  };
}

export const api = createApiClient(import.meta.env.VITE_API_BASE_URL ?? '');
