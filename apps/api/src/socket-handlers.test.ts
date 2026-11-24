import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import test from 'node:test';
import { DeviceState, DeviceStatusUpdate } from '@samsung-maintenance/shared';
import { DeviceStateEnum as PrismaDeviceState } from '@prisma/client';
import { io as createClient, Socket } from 'socket.io-client';
import { Server } from 'socket.io';
import {
  SocketApiPrisma,
  registerSocketHandlers,
} from './socket-handlers';
import { DeviceSnapshot } from './device-sync';

interface TestPrisma extends SocketApiPrisma {
  setDatabaseUnavailable(unavailable: boolean): void;
  failDevice(serialNumber: string): void;
  records: Map<string, DeviceSnapshot>;
  upsertCalls: string[];
}

interface Ack {
  ok: boolean;
  error?: string;
}

function createTestPrisma(): TestPrisma {
  const stations = new Map<string, { id: string }>();
  const records = new Map<string, DeviceSnapshot>();
  const upsertCalls: string[] = [];
  const failedDevices = new Set<string>();
  let databaseUnavailable = false;

  const prisma: TestPrisma = {
    records,
    upsertCalls,
    setDatabaseUnavailable(unavailable) {
      databaseUnavailable = unavailable;
    },
    failDevice(serialNumber) {
      failedDevices.add(serialNumber);
    },
    station: {
      async upsert({ where, create }) {
        if (!stations.has(where.name)) {
          stations.set(where.name, { id: `id:${create.name}` });
        }
      },
      async findUnique({ where }) {
        if (databaseUnavailable) throw new Error('database unavailable');
        return stations.get(where.name) ?? null;
      },
    },
    device: {
      async findUnique({ where }) {
        if (databaseUnavailable || failedDevices.has(where.serialNumber)) {
          throw new Error('database unavailable');
        }
        return records.get(where.serialNumber) ?? null;
      },
      async upsert(args) {
        if (databaseUnavailable || failedDevices.has(args.where.serialNumber)) {
          throw new Error('database unavailable');
        }
        upsertCalls.push(args.where.serialNumber);
        const { serialNumber: _serialNumber, ...createData } = args.create;
        records.set(args.where.serialNumber, {
          ...(records.get(args.where.serialNumber) ?? createData),
          ...args.update,
        });
      },
    },
  };

  return prisma;
}

async function connectClient(url: string): Promise<Socket> {
  const client = createClient(url, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 3_000,
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket.IO connection timed out')), 3_000);
    client.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    client.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return client;
}

function emitAck(client: Socket, event: string, payload: unknown): Promise<Ack> {
  return new Promise((resolve) => client.emit(event, payload, resolve));
}

test('Socket.IO authenticates stations, validates updates, and recovers after reconnects', async () => {
  const httpServer = createServer();
  const ioServer = new Server(httpServer);
  const prisma = createTestPrisma();
  const clients: Socket[] = [];
  const tokenA = 'a'.repeat(32);
  const tokenB = 'b'.repeat(32);
  registerSocketHandlers(
    ioServer,
    prisma,
    new Map([
      ['STATION_A', tokenA],
      ['STATION_B', tokenB],
    ]),
  );

  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const port = (httpServer.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  try {
    const stationA = await connectClient(url);
    clients.push(stationA);
    assert.equal(
      (await emitAck(stationA, 'register-station', {
        stationName: 'STATION_A',
        token: 'wrong-token',
      })).ok,
      false,
    );
    assert.equal(
      (await emitAck(stationA, 'device-status-update', {
        stationName: 'STATION_A',
        devices: [],
      })).ok,
      false,
    );

    assert.equal(
      (await emitAck(stationA, 'register-station', {
        stationName: 'STATION_A',
        token: tokenA,
      })).ok,
      true,
    );
    stationA.on('device-diagnostic-request', (_request, ack) => {
      ack({
        ok: true,
        diagnostic: {
          serialNumber: 'ABC123',
          collectedAt: '2026-11-24T18:00:00.000Z',
        },
      });
    });
    const diagnosticAcks = await ioServer
      .to('station:id:STATION_A')
      .timeout(1_000)
      .emitWithAck('device-diagnostic-request', {
        requestId: '00000000-0000-4000-8000-000000000001',
        serialNumber: 'ABC123',
      });
    assert.equal(diagnosticAcks[0]?.ok, true);
    stationA.on('maintenance-operation-request', (_request, ack) => {
      ack({ ok: true });
    });
    const operationAcks = await ioServer
      .to('station:id:STATION_A')
      .timeout(1_000)
      .emitWithAck('maintenance-operation-request', {
        requestId: '00000000-0000-4000-8000-000000000002',
        serialNumber: 'ABC123',
        operation: 'REBOOT',
      });
    assert.equal(operationAcks[0]?.ok, true);

    const device = {
      serialNumber: 'ABC123',
      state: DeviceState.ANDROID_INIT,
      model: 'SM-S918B',
      androidVersion: '14',
      batteryLevel: 82,
    };
    const update: DeviceStatusUpdate = {
      stationName: 'STATION_A',
      devices: [device],
    };

    assert.equal(
      (await emitAck(stationA, 'device-status-update', {
        ...update,
        devices: [{ ...device, batteryLevel: 101 }],
      })).ok,
      false,
    );
    assert.equal((await emitAck(stationA, 'device-status-update', update)).ok, true);
    assert.equal((await emitAck(stationA, 'device-status-update', update)).ok, true);
    assert.deepEqual(prisma.upsertCalls, ['ABC123']);
    assert.deepEqual(prisma.records.get('ABC123'), {
      model: 'SM-S918B',
      manufacturer: null,
      buildNumber: null,
      androidVersion: '14',
      batteryLevel: 82,
      state: PrismaDeviceState.ANDROID_INIT,
      stationId: 'id:STATION_A',
    });

    assert.equal(
      (await emitAck(stationA, 'device-status-update', {
        stationName: 'STATION_B',
        devices: [device],
      })).ok,
      false,
    );

    prisma.failDevice('BAD');
    const partialBatch = await emitAck(stationA, 'device-status-update', {
      stationName: 'STATION_A',
      devices: [
        { serialNumber: 'BAD', state: DeviceState.ANDROID_INIT },
        { serialNumber: 'GOOD', state: DeviceState.ANDROID_INIT },
      ],
    });
    assert.equal(partialBatch.ok, false);
    assert.ok(prisma.records.has('GOOD'));

    const stationB = await connectClient(url);
    clients.push(stationB);
    assert.equal(
      (await emitAck(stationB, 'register-station', {
        stationName: 'STATION_B',
        token: tokenB,
      })).ok,
      true,
    );
    assert.equal(
      (await emitAck(stationB, 'device-status-update', {
        stationName: 'STATION_B',
        devices: [device],
      })).ok,
      true,
    );
    assert.equal(prisma.records.get('ABC123')?.stationId, 'id:STATION_B');

    prisma.setDatabaseUnavailable(true);
    const databaseError = await emitAck(stationB, 'device-status-update', {
      stationName: 'STATION_B',
      devices: [device],
    });
    assert.equal(databaseError.ok, false);
    prisma.setDatabaseUnavailable(false);
    assert.equal(
      (await emitAck(stationB, 'device-status-update', {
        stationName: 'STATION_B',
        devices: [device],
      })).ok,
      true,
    );

    stationB.disconnect();
    clients.splice(clients.indexOf(stationB), 1);
    const reconnected = await connectClient(url);
    clients.push(reconnected);
    assert.equal(
      (await emitAck(reconnected, 'device-status-update', {
        stationName: 'STATION_B',
        devices: [device],
      })).ok,
      false,
    );
    assert.equal(
      (await emitAck(reconnected, 'register-station', {
        stationName: 'STATION_B',
        token: tokenB,
      })).ok,
      true,
    );
    assert.equal(
      (await emitAck(reconnected, 'device-status-update', {
        stationName: 'STATION_B',
        devices: [device],
      })).ok,
      true,
    );
  } finally {
    for (const client of clients) client.close();
    await new Promise<void>((resolve) => ioServer.close(() => resolve()));
  }
});
