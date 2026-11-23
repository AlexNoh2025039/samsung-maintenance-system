import express from 'express';
import { existsSync } from 'node:fs';
import { createServer } from 'http';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import cors from 'cors';
import { prisma } from './db';
import { parseStationTokens } from './station-auth';
import { registerSocketHandlers } from './socket-handlers';

const envFile = resolve(__dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const stationTokens = parseStationTokens(process.env.STATION_TOKENS);
if (stationTokens.size === 0) {
  console.warn('STATION_TOKENS no está configurado; se rechazarán los agentes.');
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Samsung Maintenance System API is running' });
});

registerSocketHandlers(io, prisma, stationTokens);

app.get('/api/stations', async (req, res) => {
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

app.get('/api/devices', async (req, res) => {
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

httpServer.listen(4000, () => {
  console.log('API escuchando en el puerto 4000');
});
