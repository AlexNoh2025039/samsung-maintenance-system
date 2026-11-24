import { MaintenanceOperationRequestSchema } from '@samsung-maintenance/shared';
import { DeviceMonitor } from './device-monitor';

export type MaintenanceAck = (result: { ok: boolean; error?: string }) => void;

export function createMaintenanceRequestHandler(
  monitor: Pick<DeviceMonitor, 'executeMaintenance'>,
  isRegistered: () => boolean,
  logError: (message: string) => void = (message) => console.error(message),
): (payload: unknown, ack?: MaintenanceAck) => Promise<void> {
  return async (payload, ack) => {
    const request = MaintenanceOperationRequestSchema.safeParse(payload);
    if (!request.success) {
      ack?.({ ok: false, error: 'Solicitud de operación inválida.' });
      return;
    }
    if (!isRegistered()) {
      ack?.({ ok: false, error: 'La estación no está autenticada.' });
      return;
    }
    try {
      await monitor.executeMaintenance(
        request.data.serialNumber,
        request.data.operation,
      );
      ack?.({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'La operación ADB falló.';
      logError(`No se pudo ejecutar ${request.data.operation} en ${request.data.serialNumber}: ${message}`);
      ack?.({ ok: false, error: message });
    }
  };
}
