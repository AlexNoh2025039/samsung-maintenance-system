import { Server } from 'socket.io';
import {
  DeviceStatusUpdateSchema,
  RegisterStationSchema,
} from '@samsung-maintenance/shared';
import { DeviceSyncStore, syncDeviceBatch } from './device-sync';
import { isStationTokenValid } from './station-auth';

type EventAck = (result: { ok: boolean; error?: string }) => void;

export interface SocketApiPrisma extends DeviceSyncStore {
  station: {
    upsert(args: {
      where: { name: string };
      update: { isRegistered: true };
      create: { name: string; machineName: string; isRegistered: true };
    }): Promise<unknown>;
    findUnique(args: { where: { name: string } }): Promise<{ id: string } | null>;
  };
}

export function registerSocketHandlers(
  io: Server,
  prisma: SocketApiPrisma,
  stationTokens: Map<string, string>,
): void {
  io.on('connection', (socket) => {
    console.log(`Estación o cliente conectado: ${socket.id}`);
    let registeredStationName: string | undefined;

    socket.on('register-station', async (payload: unknown, ack?: EventAck) => {
      const registration = RegisterStationSchema.safeParse(payload);
      if (!registration.success) {
        ack?.({ ok: false, error: 'Datos de registro inválidos.' });
        return;
      }

      const { stationName, token } = registration.data;
      if (!isStationTokenValid(stationTokens.get(stationName), token)) {
        console.warn(`Registro rechazado para la estación ${stationName}.`);
        ack?.({ ok: false, error: 'Estación o token no autorizado.' });
        return;
      }

      try {
        await prisma.station.upsert({
          where: { name: stationName },
          update: { isRegistered: true },
          create: {
            name: stationName,
            machineName: stationName,
            isRegistered: true,
          },
        });
        registeredStationName = stationName;
        ack?.({ ok: true });
      } catch (error) {
        console.error('Error al registrar la estación:', error);
        ack?.({ ok: false, error: 'No se pudo registrar la estación.' });
      }
    });

    socket.on('device-status-update', async (payload: unknown, ack?: EventAck) => {
      const update = DeviceStatusUpdateSchema.safeParse(payload);
      if (!update.success) {
        ack?.({ ok: false, error: 'Actualización de dispositivos inválida.' });
        return;
      }

      if (!registeredStationName || update.data.stationName !== registeredStationName) {
        ack?.({ ok: false, error: 'La estación no está autenticada para esta conexión.' });
        return;
      }

      try {
        const station = await prisma.station.findUnique({
          where: { name: registeredStationName },
        });
        if (!station) {
          ack?.({ ok: false, error: 'La estación registrada no existe.' });
          return;
        }

        const result = await syncDeviceBatch(prisma, station.id, update.data.devices);
        if (result.failed > 0) {
          ack?.({
            ok: false,
            error: `No se pudieron guardar ${result.failed} dispositivo(s).`,
          });
          return;
        }

        ack?.({ ok: true });
      } catch (error) {
        console.error('Error al actualizar dispositivos:', error);
        ack?.({ ok: false, error: 'No se pudo procesar la actualización.' });
      }
    });

    socket.on('disconnect', () => {
      registeredStationName = undefined;
      console.log(`Cliente desconectado: ${socket.id}`);
    });
  });
}
