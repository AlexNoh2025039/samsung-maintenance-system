import { DiagnosticStatus } from '@prisma/client';
import { RequestHandler, Router } from 'express';
import {
  DeviceDiagnostic,
  DeviceDiagnosticRequest,
  DeviceDiagnosticSchema,
  DeviceState,
} from '@samsung-maintenance/shared';
import { DiagnosticStore } from './diagnostic-store';

export type DiagnosticDispatcher = (
  stationId: string,
  request: DeviceDiagnosticRequest,
) => Promise<unknown>;

export function createDiagnosticRouter(
  store: DiagnosticStore,
  dispatch: DiagnosticDispatcher,
): Router {
  const router = Router();

  router.post('/:deviceId/diagnostics', async (request, response) => {
    const user = request.authUser;
    if (!user) {
      response.status(401).json({ error: 'Autenticación requerida.' });
      return;
    }

    const device = await findDevice(store, request.params.deviceId, response);
    if (!device) return;
    if (!device.station || !device.station.isRegistered) {
      response.status(409).json({ error: 'El dispositivo no pertenece a una estación registrada.' });
      return;
    }
    if (device.state !== DeviceState.ANDROID_INIT) {
      response.status(409).json({ error: 'El dispositivo no está autorizado y conectado mediante ADB.' });
      return;
    }

    let record: { id: string; createdAt: Date };
    try {
      record = await store.createDiagnostic({
        deviceId: device.id,
        stationId: device.station.id,
        userId: user.id,
      });
    } catch (error) {
      console.error('Error al registrar solicitud de diagnóstico:', error);
      response.status(500).json({ error: 'No se pudo registrar el diagnóstico.' });
      return;
    }

    try {
      const payload = await dispatch(device.station.id, {
        requestId: record.id,
        serialNumber: device.serialNumber,
      });
      const parsed = DeviceDiagnosticSchema.safeParse(payload);
      if (!parsed.success || parsed.data.serialNumber !== device.serialNumber) {
        throw new Error('La estación devolvió un resultado de diagnóstico inválido.');
      }

      const status = parsed.data.errors.length > 0
        ? DiagnosticStatus.PARTIAL
        : DiagnosticStatus.SUCCESS;
      await store.completeDiagnostic(record.id, status, JSON.stringify(parsed.data), parsed.data.errors);
      response.status(201).json({
        diagnostic: {
          ...record,
          deviceId: device.id,
          stationId: device.station.id,
          user: { id: user.id, name: user.name, email: user.email },
          status,
          result: parsed.data,
          errors: parsed.data.errors,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'La estación no pudo completar el diagnóstico.';
      try {
        await store.completeDiagnostic(record.id, DiagnosticStatus.FAILED, null, [message]);
      } catch (storeError) {
        console.error('Error al guardar el fallo de diagnóstico:', storeError);
        response.status(500).json({
          error: 'El diagnóstico falló y tampoco se pudo guardar su resultado.',
          diagnosticId: record.id,
        });
        return;
      }
      response.status(503).json({
        error: message,
        diagnosticId: record.id,
      });
    }
  });

  router.get('/:deviceId/diagnostics', async (request, response) => {
    if (!request.authUser) {
      response.status(401).json({ error: 'Autenticación requerida.' });
      return;
    }
    const device = await findDevice(store, request.params.deviceId, response);
    if (!device) return;
    try {
      const records = await store.listDiagnostics(device.id);
      response.json({
        diagnostics: records.map((record) => ({
          ...record,
          result: parseStoredJson(record.result),
          errors: parseStoredErrors(record.errors),
        })),
      });
    } catch (error) {
      console.error('Error al consultar diagnósticos:', error);
      response.status(500).json({ error: 'No se pudo consultar el historial de diagnósticos.' });
    }
  });

  return router;
}

async function findDevice(
  store: DiagnosticStore,
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
    console.error('Error al consultar dispositivo para diagnóstico:', error);
    response.status(500).json({ error: 'No se pudo consultar el dispositivo.' });
    return null;
  }
}

function parseStoredJson(value: string | null): DeviceDiagnostic | null {
  if (!value) return null;
  try {
    return DeviceDiagnosticSchema.parse(JSON.parse(value));
  } catch (error) {
    console.error('Registro de diagnóstico almacenado con formato inválido:', error);
    return null;
  }
}

function parseStoredErrors(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? parsed
      : ['No se pudieron leer los errores almacenados.'];
  } catch (error) {
    console.error('Errores de diagnóstico almacenados con formato inválido:', error);
    return ['No se pudieron leer los errores almacenados.'];
  }
}
