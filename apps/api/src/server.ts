import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { DeviceStateEnum } from '@prisma/client';
import { prisma } from './db';

interface ConnectedDevice {
  serialNumber: string;
  status: string;
}

interface DeviceStatusUpdate {
  stationName: string;
  devices: ConnectedDevice[];
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Samsung Maintenance System API is running' });
});

// Configuración de Socket.IO para los agentes de las estaciones
io.on('connection', (socket) => {
  console.log(`Estación o cliente conectado: ${socket.id}`);

  // Evento cuando el agente se registra con el nombre de la PC
  socket.on('register-station', async ({ stationName }) => {
    try {
      // Buscar o crear la estación en la base de datos
      await prisma.station.upsert({
        where: { name: stationName },
        update: { isRegistered: true },
        create: {
          name: stationName,
          machineName: stationName,
          isRegistered: true,
        },
      });
      console.log(`Estación registrada en BD: ${stationName}`);
    } catch (error) {
      console.error('Error al registrar la estación:', error);
    }
  });

  // Evento cuando el agente reporta los dispositivos conectados por USB
  socket.on('device-status-update', async ({ stationName, devices }: DeviceStatusUpdate) => {
    try {
      // Buscar la estación en la base de datos para obtener su ID
      const station = await prisma.station.findUnique({
        where: { name: stationName },
      });

      if (!station) return;

      for (const device of devices) {
        const state = {
          device: DeviceStateEnum.ANDROID_INIT,
          recovery: DeviceStateEnum.RECOVERY,
          sideload: DeviceStateEnum.DOWNLOAD_MODE,
        }[device.status] ?? DeviceStateEnum.UNKNOWN;

        // Actualizar o crear el dispositivo vinculado a esta estación
        await prisma.device.upsert({
          where: { serialNumber: device.serialNumber },
          update: {
            state,
            stationId: station.id,
          },
          create: {
            serialNumber: device.serialNumber,
            model: 'Samsung Device', // Se actualizará al leer las propiedades completas por ADB
            state,
            stationId: station.id,
          },
        });
      }
      console.log(`Dispositivos actualizados para la estación ${stationName}:`, devices.length);
    } catch (error) {
      console.error('Error al actualizar dispositivos:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Cliente desconectado: ${socket.id}`);
  });
});

// Obtener todas las estaciones registradas y sus dispositivos
app.get('/api/stations', async (req, res) => {
  try {
    const stations = await prisma.station.findMany({
      include: { devices: true },
    });
    res.json(stations);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener las estaciones' });
  }
});

// Obtener todos los dispositivos conectados en el sistema
app.get('/api/devices', async (req, res) => {
  try {
    const devices = await prisma.device.findMany({
      include: { station: true },
    });
    res.json(devices);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los dispositivos' });
  }
});

httpServer.listen(4000, () => {
  console.log('API escuchando en el puerto 4000');
});