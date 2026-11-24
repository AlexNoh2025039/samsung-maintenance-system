import {
  DeviceDiagnostic,
  DeviceDiagnosticRequestSchema,
} from '@samsung-maintenance/shared';
import { DeviceMonitor } from './device-monitor';

export type DiagnosticAck = (result: {
  ok: boolean;
  diagnostic?: DeviceDiagnostic;
  error?: string;
}) => void;

export function createDiagnosticRequestHandler(
  monitor: Pick<DeviceMonitor, 'diagnose'>,
  isRegistered: () => boolean,
  logError: (message: string) => void = (message) => console.error(message),
): (payload: unknown, ack?: DiagnosticAck) => Promise<void> {
  return async (payload, ack) => {
    const request = DeviceDiagnosticRequestSchema.safeParse(payload);
    if (!request.success) {
      ack?.({ ok: false, error: 'Solicitud de diagnóstico inválida.' });
      return;
    }
    if (!isRegistered()) {
      ack?.({ ok: false, error: 'La estación no está autenticada.' });
      return;
    }

    try {
      const diagnostic = await monitor.diagnose(request.data.serialNumber);
      ack?.({ ok: true, diagnostic });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falló el diagnóstico ADB.';
      logError(`No se pudo diagnosticar ${request.data.serialNumber}: ${message}`);
      ack?.({ ok: false, error: message });
    }
  };
}
