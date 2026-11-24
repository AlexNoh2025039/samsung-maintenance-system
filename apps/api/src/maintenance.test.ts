import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import test from 'node:test';
import { AddressInfo } from 'node:net';
import { Role } from '@prisma/client';
import { DeviceState } from '@samsung-maintenance/shared';
import { AuthenticatedUser } from './auth-types';
import {
  createMaintenanceRouter,
  MaintenanceDispatchError,
} from './maintenance-routes';
import { MaintenanceRecord, MaintenanceStore } from './maintenance-store';

const admin: AuthenticatedUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: Role.ADMIN,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createStore(manufacturer: string | null = 'samsung') {
  const saved: MaintenanceRecord[] = [];
  const store: MaintenanceStore = {
    async findDevice(id) {
      if (id !== 'device-1') return null;
      return {
        id,
        serialNumber: 'SERIAL-1',
        state: DeviceState.ANDROID_INIT,
        manufacturer,
        station: { id: 'station-1', isRegistered: true },
      };
    },
    async createOperation(input) {
      const record = {
        id: '00000000-0000-4000-8000-000000000001',
        type: input.type,
        status: 'PENDING',
        details: null,
        createdAt: new Date(),
        user: { id: input.userId, name: admin.name, email: admin.email, role: admin.role },
      };
      saved.push(record);
      return { id: record.id, createdAt: record.createdAt };
    },
    async completeOperation(id, status, details) {
      const record = saved.find((item) => item.id === id);
      if (!record) throw new Error('operation not found');
      record.status = status;
      record.details = details;
    },
    async listOperations() {
      return saved;
    },
  };
  return { store, saved };
}

async function startRouter(
  store: MaintenanceStore,
  dispatch: Parameters<typeof createMaintenanceRouter>[1],
  user = admin,
) {
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.authUser = user;
    next();
  });
  app.use('/api/devices', createMaintenanceRouter(store, dispatch));
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

test('maintenance route requires exact confirmation and records the operator and result', async () => {
  const { store, saved } = createStore();
  const app = await startRouter(store, async (_stationId, request) => {
    assert.equal(request.serialNumber, 'SERIAL-1');
    assert.equal(request.operation, 'REBOOT');
  });
  try {
    const invalid = await fetch(`${app.url}/api/devices/device-1/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'REBOOT', confirmation: 'yes' }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(saved.length, 0);

    const accepted = await fetch(`${app.url}/api/devices/device-1/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'REBOOT',
        confirmation: 'REBOOT SERIAL-1',
      }),
    });
    assert.equal(accepted.status, 201);
    const body = await accepted.json();
    assert.equal(body.operation.status, 'SUCCESS');
    assert.equal(saved[0]?.user.id, admin.id);
  } finally {
    await app.close();
  }
});

test('only ADMIN and SUPERVISOR can request recovery restart', async () => {
  const technician: AuthenticatedUser = { ...admin, role: Role.TECHNICIAN };
  const { store, saved } = createStore();
  const app = await startRouter(store, async () => {
    throw new Error('must not dispatch');
  }, technician);
  try {
    const response = await fetch(`${app.url}/api/devices/device-1/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'REBOOT_RECOVERY',
        confirmation: 'REBOOT_RECOVERY SERIAL-1',
      }),
    });
    assert.equal(response.status, 403);
    assert.equal(saved.length, 0);
  } finally {
    await app.close();
  }
});

test('maintenance route refuses devices without a verified Samsung manufacturer', async () => {
  const { store, saved } = createStore(null);
  const app = await startRouter(store, async () => {
    throw new Error('must not dispatch');
  });
  try {
    const response = await fetch(`${app.url}/api/devices/device-1/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'REBOOT',
        confirmation: 'REBOOT SERIAL-1',
      }),
    });
    assert.equal(response.status, 409);
    assert.equal(saved.length, 0);
  } finally {
    await app.close();
  }
});

test('unconfirmed agent outcome is stored as UNKNOWN rather than falsely reported as failure', async () => {
  const { store, saved } = createStore();
  const app = await startRouter(store, async () => {
    throw new MaintenanceDispatchError('No se recibió confirmación.', 'UNKNOWN');
  });
  try {
    const response = await fetch(`${app.url}/api/devices/device-1/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'REBOOT',
        confirmation: 'REBOOT SERIAL-1',
      }),
    });
    assert.equal(response.status, 504);
    assert.equal(saved[0]?.status, 'UNKNOWN');

    const history = await fetch(`${app.url}/api/devices/device-1/operations`);
    const body = await history.json();
    assert.equal(body.operations[0].status, 'UNKNOWN');
  } finally {
    await app.close();
  }
});
