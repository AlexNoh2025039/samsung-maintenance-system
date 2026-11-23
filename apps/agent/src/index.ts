import { io } from 'socket.io-client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DeviceStatusUpdate } from '@samsung-maintenance/shared';
import { DeviceMonitor } from './device-monitor';

const envFile = resolve(__dirname, '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const serverUrl = process.env.SERVER_URL || 'http://localhost:4000';
const stationName =
  process.env.STATION_NAME || process.env.COMPUTERNAME || 'ESTACION-DESCONOCIDA';
const stationToken = process.env.STATION_TOKEN;
const scanIntervalMs = 5_000;

if (!stationToken) {
  console.error('Falta STATION_TOKEN; el agente no puede autenticarse.');
  process.exitCode = 1;
} else {
  const socket = io(serverUrl);
  const monitor = new DeviceMonitor();
  let registered = false;
  let stopped = false;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;

  socket.on('connect', () => {
    registered = false;
    socket.timeout(5_000).emit(
      'register-station',
      { stationName, token: stationToken },
      (error: Error | null, response: { ok: boolean; error?: string }) => {
        if (error || !response?.ok) {
          console.error(
            `No se pudo registrar la estación ${stationName}: ${
              response?.error ?? error?.message ?? 'respuesta inválida'
            }`,
          );
          return;
        }

        registered = true;
        console.log(`Agente autenticado para la estación ${stationName}.`);
      },
    );
  });

  socket.on('disconnect', (reason) => {
    registered = false;
    console.warn(`Desconectado del servidor Socket.IO: ${reason}`);
  });

  async function scanDevices(): Promise<void> {
    if (stopped) return;

    try {
      const devices = await monitor.scan();
      if (registered && socket.connected) {
        const update: DeviceStatusUpdate = { stationName, devices };
        socket.timeout(5_000).emit(
          'device-status-update',
          update,
          (error: Error | null, response: { ok: boolean; error?: string }) => {
            if (error || !response?.ok) {
              console.error(
                `No se confirmó la actualización de dispositivos: ${
                  response?.error ?? error?.message ?? 'respuesta inválida'
                }`,
              );
            }
          },
        );
      }
    } catch (error) {
      console.error(
        'Falló el escaneo de ADB:',
        error instanceof Error ? error.message : error,
      );
    } finally {
      if (!stopped) scanTimer = setTimeout(() => void scanDevices(), scanIntervalMs);
    }
  }

  function stopAgent(): void {
    stopped = true;
    clearTimeout(scanTimer);
    socket.close();
  }

  process.once('SIGINT', stopAgent);
  process.once('SIGTERM', stopAgent);
  void scanDevices();
}
