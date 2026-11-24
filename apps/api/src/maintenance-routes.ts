import { RequestHandler, Router } from 'express';
import {
  DeviceState,
  ExecuteMaintenanceOperationSchema,
  MaintenanceOperationRequest,
} from '@samsung-maintenance/shared';
import { MaintenanceStore } from './maintenance-store';

export class MaintenanceDispatchError extends Error {
  constructor(
    message: string,
    readonly outcome: 'FAILED' | 'UNKNOWN',
  ) {
    super(message);
  }
}

export type MaintenanceDispatcher = (
  stationId: string,
  request: MaintenanceOperationRequest,
) => Promise<void>;

export function createMaintenanceRouter(
  store: MaintenanceStore,
  dispatch: MaintenanceDispatcher,
): Router {
  const router = Router();

  router.post('/:deviceId/operations', async (request, response) => {
    const user = request.authUser;
    if (!user) {
      response.status(401).json({ error: 'Autenticación requerida.' });
      return;
    }

    const parsed = ExecuteMaintenanceOperationSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'La operación y su confirmación son obligatorias.' });
      return;
    }
    const operation = parsed.data.operation;
    if (operation === 'REBOOT_RECOVERY' && user.role === 'TECHNICIAN') {
      response.status(403).json({ error: 'El reinicio a recovery requiere rol ADMIN o SUPERVISOR.' });
      return;
    }

    const device = await findDevice(store, request.params.deviceId, response);
    if (!device) return;
    const expectedConfirmation = `${operation} ${device.serialNumber}`;
    if (parsed.data.confirmation !== expectedConfirmation) {
      response.status(400).json({
        error: `Escribe exactamente "${expectedConfirmation}" para confirmar.`,
      });
      return;
    }
    if (!device.station || !device.station.isRegistered) {
      response.status(409).json({ error: 'El dispositivo no pertenece a una estación registrada.' });
      return;
    }
    if (device.state !== DeviceState.ANDROID_INIT) {
      response.status(409).json({ error: 'El dispositivo no está conectado y autorizado mediante ADB.' });
      return;
    }
    if (device.manufacturer?.toLowerCase() !== 'samsung') {
      response.status(409).json({ error: 'El fabricante Samsung aún no está verificado para este dispositivo.' });
      return;
    }

    let record: { id: string; createdAt: Date };
    try {
      record = await store.createOperation({
        type: operation,
        deviceId: device.id,
        stationId: device.station.id,
        userId: user.id,
      });
    } catch (error) {
      console.error('Error al registrar operación de mantenimiento:', error);
      response.status(500).json({ error: 'No se pudo registrar la operación.' });
      return;
    }

    try {
      await dispatch(device.station.id, {
        requestId: record.id,
        serialNumber: device.serialNumber,
        operation,
      });
      const details = JSON.stringify({
        operation,
        result: 'Comando ADB aceptado por el agente; reinicio físico pendiente de verificación.',
      });
      await store.completeOperation(record.id, 'SUCCESS', details);
      response.status(201).json({
        operation: {
          ...record,
          deviceId: device.id,
          stationId: device.station.id,
          type: operation,
          status: 'SUCCESS',
          details,
          user: { id: user.id, name: user.name, email: user.email, role: user.role },
        },
      });
    } catch (error) {
      const outcome = error instanceof MaintenanceDispatchError ? error.outcome : 'UNKNOWN';
      const message = error instanceof Error ? error.message : 'La estación no confirmó la operación.';
      const details = JSON.stringify({ operation, result: message });
      try {
        await store.completeOperation(record.id, outcome, details);
      } catch (storeError) {
        console.error('Error al guardar el resultado de operación:', storeError);
        response.status(500).json({
          error: 'La operación no pudo confirmarse y tampoco se pudo guardar su resultado.',
          operationId: record.id,
        });
        return;
      }
      response.status(outcome === 'FAILED' ? 503 : 504).json({
        error: message,
        operationId: record.id,
        status: outcome,
      });
    }
  });

  router.get('/:deviceId/operations', async (request, response) => {
    if (!request.authUser) {
      response.status(401).json({ error: 'Autenticación requerida.' });
      return;
    }
    const device = await findDevice(store, request.params.deviceId, response);
    if (!device) return;
    try {
      response.json({ operations: await store.listOperations(device.id) });
    } catch (error) {
      console.error('Error al consultar operaciones del dispositivo:', error);
      response.status(500).json({ error: 'No se pudo consultar el historial de operaciones.' });
    }
  });

  return router;
}

async function findDevice(
  store: MaintenanceStore,
  id: string,
  response: Parameters<RequestHandler>[1],
) {
  if (!id || id.length > 128) {
    response.status(400).json({ error: 'El identificador del dispositivo no es válido.' });
    return null;
  }
  try {
    const device = await store.findDevice(id);
    if (!device) response.status(404).json({ error: 'Dispositivo no encontrado.' });
    return device;
  } catch (error) {
    console.error('Error al consultar dispositivo para mantenimiento:', error);
    response.status(500).json({ error: 'No se pudo consultar el dispositivo.' });
    return null;
  }
}
