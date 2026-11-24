import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import test from 'node:test';
import { AddressInfo } from 'node:net';
import { DiagnosticStatus, Role } from '@prisma/client';
import { DeviceDiagnostic, DeviceState } from '@samsung-maintenance/shared';
import { AuthenticatedUser } from './auth-types';
import { createDiagnosticRouter } from './diagnostic-routes';
import { DiagnosticRecord, DiagnosticStore } from './diagnostic-store';

const admin: AuthenticatedUser = {
  id: 'user-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: Role.ADMIN,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const diagnostic: DeviceDiagnostic = {
  serialNumber: 'SERIAL-1',
  collectedAt: '2026-11-24T18:00:00.000Z',
  adbAuthorized: true,
  properties: { manufacturer: 'samsung', model: 'SM-S918B', androidVersion: '14', buildNumber: 'TP1A' },
  battery: { level: 78, temperatureCelsius: 31.2 },
  storage: { totalBytes: 1000, usedBytes: 300, availableBytes: 700 },
  memory: { totalBytes: 4000, availableBytes: 2000 },
  connectivity: { interfaces: [{ name: 'wlan0', addresses: ['192.0.2.10'] }], defaultRoutes: ['default via 192.0.2.1'] },
  usbDebugging: true,
  errors: [],
};

function createStore() {
  const saved: DiagnosticRecord[] = [];
  const store: DiagnosticStore = {
    async findDevice(id) {
      if (id !== 'device-1') return null;
      return {
        id,
        serialNumber: 'SERIAL-1',
        state: DeviceState.ANDROID_INIT,
        stationId: 'station-1',
        station: { id: 'station-1', isRegistered: true },
      };
    },
    async createDiagnostic(input) {
      const record = {
        id: '00000000-0000-4000-8000-000000000001',
        createdAt: new Date(),
        status: DiagnosticStatus.PENDING,
        result: null,
        errors: null,
        completedAt: null,
        user: { id: input.userId, name: admin.name, email: admin.email },
      };
      saved.push(record);
      return { id: record.id, createdAt: record.createdAt };
    },
    async completeDiagnostic(id, status, result, errors) {
      const record = saved.find((item) => item.id === id);
      if (!record) throw new Error('diagnostic not found');
      record.status = status;
      record.result = result;
      record.errors = errors.length > 0 ? JSON.stringify(errors) : null;
      record.completedAt = new Date();
    },
    async listDiagnostics() {
      return saved;
    },
  };
  return { store, saved };
}

async function startRouter(
  store: DiagnosticStore,
  dispatch: Parameters<typeof createDiagnosticRouter>[1],
) {
  const app = express();
  app.use((request, _response, next) => {
    request.authUser = admin;
    next();
  });
  app.use('/api/devices', createDiagnosticRouter(store, dispatch));
  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
  };
}

test('diagnostic endpoint dispatches to the assigned station and persists real results', async () => {
  const { store, saved } = createStore();
  const app = await startRouter(store, async (stationId, request) => {
    assert.equal(stationId, 'station-1');
    assert.equal(request.serialNumber, diagnostic.serialNumber);
    return diagnostic;
  });
  try {
    const response = await fetch(`${app.url}/api/devices/device-1/diagnostics`, { method: 'POST' });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.diagnostic.status, 'SUCCESS');
    assert.equal(body.diagnostic.result.battery.level, 78);
    assert.equal(saved[0]?.status, DiagnosticStatus.SUCCESS);
    assert.equal(saved[0]?.result, JSON.stringify(diagnostic));
  } finally {
    await app.close();
  }
});

test('diagnostic failure is persisted and visible in device history', async () => {
  const { store, saved } = createStore();
  const app = await startRouter(store, async () => {
    throw new Error('No hay un agente conectado.');
  });
  try {
    const response = await fetch(`${app.url}/api/devices/device-1/diagnostics`, { method: 'POST' });
    assert.equal(response.status, 503);
    assert.equal(saved[0]?.status, DiagnosticStatus.FAILED);

    const history = await fetch(`${app.url}/api/devices/device-1/diagnostics`);
    const body = await history.json();
    assert.equal(body.diagnostics[0].status, 'FAILED');
    assert.deepEqual(body.diagnostics[0].errors, ['No hay un agente conectado.']);
  } finally {
    await app.close();
  }
});

test('diagnostic rejects a result for a different serial and persists failure', async () => {
  const { store, saved } = createStore();
  const app = await startRouter(store, async () => ({ ...diagnostic, serialNumber: 'OTHER' }));
  try {
    const response = await fetch(`${app.url}/api/devices/device-1/diagnostics`, { method: 'POST' });
    assert.equal(response.status, 503);
    assert.equal(saved[0]?.status, DiagnosticStatus.FAILED);
  } finally {
    await app.close();
  }
});
