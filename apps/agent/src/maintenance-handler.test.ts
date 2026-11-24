import assert from 'node:assert/strict';
import test from 'node:test';
import { createMaintenanceRequestHandler } from './maintenance-handler';

test('maintenance handler rejects invalid or unauthenticated station requests', async () => {
  let commands = 0;
  const handler = createMaintenanceRequestHandler(
    { async executeMaintenance() { commands += 1; } },
    () => false,
  );
  const responses: Array<{ ok: boolean; error?: string }> = [];
  const ack = (result: typeof responses[number]) => responses.push(result);
  const request = {
    requestId: '00000000-0000-4000-8000-000000000001',
    serialNumber: 'SERIAL-1',
    operation: 'REBOOT',
  };

  await handler({ ...request, operation: 'FACTORY_RESET' }, ack);
  assert.deepEqual(responses.pop(), { ok: false, error: 'Solicitud de operación inválida.' });
  await handler(request, ack);
  assert.deepEqual(responses.pop(), { ok: false, error: 'La estación no está autenticada.' });
  assert.equal(commands, 0);
});

test('maintenance handler executes only a validated reboot operation and acknowledges it', async () => {
  const operations: string[] = [];
  const handler = createMaintenanceRequestHandler(
    {
      async executeMaintenance(serialNumber, operation) {
        operations.push(`${operation}:${serialNumber}`);
      },
    },
    () => true,
  );
  let response: { ok: boolean; error?: string } | undefined;
  await handler({
    requestId: '00000000-0000-4000-8000-000000000001',
    serialNumber: 'SERIAL-1',
    operation: 'REBOOT_RECOVERY',
  }, (value) => {
    response = value;
  });

  assert.deepEqual(operations, ['REBOOT_RECOVERY:SERIAL-1']);
  assert.deepEqual(response, { ok: true });
});
