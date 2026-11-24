import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'http';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import cors from 'cors';
import { Role } from '@prisma/client';
import { prisma } from './db';
import { parseStationTokens } from './station-auth';
import { registerSocketHandlers } from './socket-handlers';
import { PrismaAuthStore } from './auth-store';
import { createRequireAuth, requireRoles } from './auth-middleware';
import { createAuthRouter } from './auth-routes';
import { createUserRouter } from './user-routes';
import { createAdminRouter } from './admin-routes';
import { createDiagnosticRouter } from './diagnostic-routes';
import { PrismaDiagnosticStore } from './diagnostic-store';
import { createMaintenanceRouter, MaintenanceDispatchError } from './maintenance-routes';
import { PrismaMaintenanceStore } from './maintenance-store';

const envFile = resolve(__dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const sessionTtlHours = Number(process.env.AUTH_SESSION_TTL_HOURS ?? '8');
const apiHost = process.env.API_HOST?.trim() || '127.0.0.1';
if (!Number.isInteger(sessionTtlHours) || sessionTtlHours < 1 || sessionTtlHours > 720) {
  throw new Error('AUTH_SESSION_TTL_HOURS must be an integer between 1 and 720.');
}

const stationTokens = parseStationTokens(process.env.STATION_TOKENS);
if (stationTokens.size === 0) {
  console.warn('STATION_TOKENS no está configurado; se rechazarán los agentes.');
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
  },
});

app.use(
  cors({
    origin(origin, callback) {
      callback(null, origin === undefined || allowedOrigins.includes(origin));
    },
  }),
);
app.use(express.json({ limit: '16kb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Samsung Maintenance System API is running' });
});

registerSocketHandlers(io, prisma, stationTokens);

const authStore = new PrismaAuthStore(prisma);
const requireAuth = createRequireAuth(authStore);
app.use('/api/auth', createAuthRouter(authStore, requireAuth, sessionTtlHours));
app.use('/api/users', requireAuth, requireRoles(Role.ADMIN), createUserRouter(authStore));
app.use('/api/admin', requireAuth, requireRoles(Role.ADMIN), createAdminRouter(authStore));

const inventoryRoles = [Role.ADMIN, Role.SUPERVISOR, Role.TECHNICIAN];

app.use(
  '/api/devices',
  requireAuth,
  requireRoles(...inventoryRoles),
  createDiagnosticRouter(
    new PrismaDiagnosticStore(prisma),
    async (stationId, diagnosticRequest) => {
      const sockets = await io.in(`station:${stationId}`).fetchSockets();
      if (sockets.length === 0) {
        throw new Error('No hay un agente conectado a la estación del dispositivo.');
      }
      if (sockets.length > 1) {
        throw new Error('Hay más de un agente conectado a la estación; se requiere una sola conexión.');
      }
      const [ack] = await io
        .to(sockets[0].id)
        .timeout(60_000)
        .emitWithAck('device-diagnostic-request', diagnosticRequest);
      if (!ack || typeof ack !== 'object' || !('ok' in ack) || ack.ok !== true) {
        const message =
          ack && typeof ack === 'object' && 'error' in ack && typeof ack.error === 'string'
            ? ack.error
            : 'La estación rechazó la solicitud de diagnóstico.';
        throw new Error(message);
      }
      return 'diagnostic' in ack ? ack.diagnostic : undefined;
    },
  ),
);

app.use(
  '/api/devices',
  requireAuth,
  requireRoles(...inventoryRoles),
  createMaintenanceRouter(
    new PrismaMaintenanceStore(prisma),
    async (stationId, operationRequest) => {
      const sockets = await io.in(`station:${stationId}`).fetchSockets();
      if (sockets.length === 0) {
        throw new MaintenanceDispatchError(
          'No hay un agente conectado a la estación del dispositivo.',
          'FAILED',
        );
      }
      if (sockets.length > 1) {
        throw new MaintenanceDispatchError(
          'Hay más de un agente conectado a la estación; se requiere una sola conexión.',
          'FAILED',
        );
      }

      let acknowledgements: unknown[];
      try {
        acknowledgements = await io
          .to(sockets[0].id)
          .timeout(20_000)
          .emitWithAck('maintenance-operation-request', operationRequest);
      } catch {
        throw new MaintenanceDispatchError(
          'La estación no confirmó si el comando se ejecutó; revisa el dispositivo antes de reintentar.',
          'UNKNOWN',
        );
      }
      const ack = acknowledgements[0];
      if (!ack || typeof ack !== 'object' || !('ok' in ack) || ack.ok !== true) {
        const message =
          ack && typeof ack === 'object' && 'error' in ack && typeof ack.error === 'string'
            ? ack.error
            : 'La estación rechazó la operación.';
        throw new MaintenanceDispatchError(message, 'FAILED');
      }
    },
  ),
);

app.get('/api/stations', requireAuth, requireRoles(...inventoryRoles), async (req, res) => {
  try {
    const stations = await prisma.station.findMany({
      include: { devices: true },
    });
    res.json(stations);
  } catch (error) {
    console.error('Error al obtener las estaciones:', error);
    res.status(500).json({ error: 'Error al obtener las estaciones' });
  }
});

app.get('/api/devices', requireAuth, requireRoles(...inventoryRoles), async (req, res) => {
  try {
    const devices = await prisma.device.findMany({
      include: { station: true },
    });
    res.json(devices);
  } catch (error) {
    console.error('Error al obtener los dispositivos:', error);
    res.status(500).json({ error: 'Error al obtener los dispositivos' });
  }
});

httpServer.listen(4000, apiHost, () => {
  console.log(`API escuchando en http://${apiHost}:4000`);
});
