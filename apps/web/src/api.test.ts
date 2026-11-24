import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@samsung-maintenance/shared';
import { ApiError, createApiClient } from './api';

const user = {
  id: 'user-id',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'ADMIN',
  isActive: true,
  createdAt: '2026-11-24T00:00:00.000Z',
  updatedAt: '2026-11-24T00:00:00.000Z',
};

afterEach(() => vi.restoreAllMocks());

describe('authentication API client', () => {
  it('sends login credentials without persisting or logging them', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ token: 'opaque-session-token', user }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createApiClient('http://localhost:4000', fetcher);

    await expect(client.login('admin@example.com', 'secret')).resolves.toEqual({
      token: 'opaque-session-token',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:4000/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'admin@example.com', password: 'secret' }),
      }),
    );
  });

  it('sends the opaque bearer token when requesting the current user', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ user }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createApiClient('', fetcher);

    await expect(client.me('opaque-session-token')).resolves.toMatchObject({
      id: user.id,
      role: 'ADMIN',
    });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({
        headers: { Authorization: 'Bearer opaque-session-token' },
      }),
    );
  });

  it('preserves backend authentication errors and status codes', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Credenciales inválidas.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createApiClient('', fetcher);

    await expect(client.login('wrong@example.com', 'wrong')).rejects.toEqual(
      expect.objectContaining<ApiError>({
        name: 'ApiError',
        message: 'Credenciales inválidas.',
        status: 401,
      }),
    );
  });

  it('rejects malformed user payloads rather than trusting invalid role data', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ user: { ...user, role: 'ROOT' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = createApiClient('', fetcher);
    await expect(client.me('opaque-session-token')).rejects.toThrow('formato inválido');
  });

  it('requests logout with the current bearer token', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createApiClient('', fetcher);

    await expect(client.logout('opaque-session-token')).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer opaque-session-token' },
      }),
    );
  });

  it('uses the protected user management endpoints without returning password fields', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ user }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: { ...user, name: 'Updated' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    const client = createApiClient('', fetcher);

    await expect(client.createUser('session', {
      email: user.email,
      name: user.name,
      password: 'a-secure-password',
      role: 'ADMIN' as UserRole,
    })).resolves.toMatchObject({ name: 'Admin' });
    await expect(client.updateUser('session', user.id, {
      name: 'Updated',
    })).resolves.toMatchObject({ name: 'Updated' });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer session' },
    });
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      method: 'PATCH',
      headers: { Authorization: 'Bearer session' },
    });
  });

  it('parses admin session and audit responses without exposing session tokens', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        sessions: [{
          id: 'session-id',
          createdAt: '2026-11-24T00:00:00.000Z',
          expiresAt: '2026-11-24T08:00:00.000Z',
          revokedAt: null,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            isActive: true,
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entries: [{
          id: 'audit-id',
          action: 'USER_CREATED',
          target: 'user-id',
          details: '{"role":"ADMIN"}',
          createdAt: '2026-11-24T00:00:00.000Z',
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const client = createApiClient('', fetcher);

    await expect(client.adminSessions('session')).resolves.toMatchObject([
      { id: 'session-id', user: { email: user.email } },
    ]);
    await expect(client.auditEntries('session')).resolves.toMatchObject([
      { action: 'USER_CREATED', target: 'user-id' },
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/admin/sessions');
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/admin/audit');
  });

  it('runs a diagnostic and reads its persisted device history', async () => {
    const result = {
      serialNumber: 'SERIAL-1',
      collectedAt: '2026-11-24T18:00:00.000Z',
      adbAuthorized: true,
      properties: { manufacturer: 'samsung', model: 'SM-S918B', androidVersion: '14', buildNumber: 'TP1A' },
      battery: { level: 78, temperatureCelsius: 31.2 },
      storage: { totalBytes: 1000, usedBytes: 300, availableBytes: 700 },
      memory: { totalBytes: 4000, availableBytes: 2000 },
      connectivity: { interfaces: [], defaultRoutes: [] },
      usbDebugging: true,
      errors: [],
    };
    const record = {
      id: 'diagnostic-id',
      status: 'SUCCESS',
      result,
      errors: [],
      createdAt: '2026-11-24T18:00:00.000Z',
      completedAt: '2026-11-24T18:00:01.000Z',
      user: { id: 'user-id', name: 'Admin', email: 'admin@example.com' },
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ diagnostic: record }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ diagnostics: [record] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    const client = createApiClient('', fetcher);

    await expect(client.runDiagnostic('session', 'device-id')).resolves.toMatchObject({
      status: 'SUCCESS',
      result: { battery: { level: 78 } },
    });
    await expect(client.diagnosticHistory('session', 'device-id')).resolves.toMatchObject([
      { id: 'diagnostic-id', user: { name: 'Admin' } },
    ]);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/devices/device-id/diagnostics');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer session' },
    });
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/devices/device-id/diagnostics');
  });

  it('sends an explicitly confirmed safe reboot and loads operation history', async () => {
    const operation = {
      id: 'operation-id',
      type: 'REBOOT',
      status: 'SUCCESS',
      details: '{"result":"accepted"}',
      createdAt: '2026-11-24T18:00:00.000Z',
      user: { id: 'user-id', name: 'Admin', email: 'admin@example.com', role: 'ADMIN' },
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ operation }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ operations: [operation] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    const client = createApiClient('', fetcher);

    await expect(client.runMaintenanceOperation(
      'session',
      'device-id',
      'REBOOT',
      'REBOOT SERIAL-1',
    )).resolves.toMatchObject({ status: 'SUCCESS', type: 'REBOOT' });
    await expect(client.operationHistory('session', 'device-id')).resolves.toMatchObject([
      { id: 'operation-id', user: { name: 'Admin' } },
    ]);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ operation: 'REBOOT', confirmation: 'REBOOT SERIAL-1' }),
    });
  });

  it('reads the protected real dashboard summary', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        summary: {
          stations: 2,
          devices: 5,
          users: 3,
          activeUsers: 3,
          activeSessions: 2,
          operations: 7,
          auditEntries: 12,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = createApiClient('', fetcher);

    await expect(client.dashboardSummary('session')).resolves.toMatchObject({
      stations: 2,
      devices: 5,
      activeSessions: 2,
    });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin/dashboard',
      expect.objectContaining({ headers: { Authorization: 'Bearer session' } }),
    );
  });

  it('updates station display metadata through the protected admin endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        station: {
          id: 'station-id',
          name: 'WORKSTATION-01',
          machineName: 'Taller Norte',
          isRegistered: true,
          createdAt: '2026-11-24T00:00:00.000Z',
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = createApiClient('', fetcher);

    await expect(client.updateStation('session', 'station-id', {
      machineName: 'Taller Norte',
    })).resolves.toMatchObject({
      name: 'WORKSTATION-01',
      machineName: 'Taller Norte',
    });
    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin/stations/station-id',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
