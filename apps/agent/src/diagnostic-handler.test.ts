import assert from 'node:assert/strict';
import test from 'node:test';
import { DeviceDiagnostic } from '@samsung-maintenance/shared';
import { createDiagnosticRequestHandler } from './diagnostic-handler';

const diagnostic: DeviceDiagnostic = {
  serialNumber: 'SERIAL-1',
  collectedAt: '2026-11-24T18:00:00.000Z',
  adbAuthorized: true,
  properties: { model: 'SM-S918B' },
  battery: {},
  storage: {},
  memory: {},
  connectivity: { interfaces: [], defaultRoutes: [] },
  usbDebugging: null,
  errors: [],
};

test('diagnostic request handler returns data only to a registered station', async () => {
  let authorized = false;
  let reads = 0;
  const handler = createDiagnosticRequestHandler(
    {
      async diagnose() {
        reads += 1;
        return diagnostic;
      },
    },
    () => authorized,
  );
  const responses: Array<{ ok: boolean; diagnostic?: DeviceDiagnostic; error?: string }> = [];
  const ack = (result: typeof responses[number]) => responses.push(result);
  const request = {
    requestId: '00000000-0000-4000-8000-000000000001',
    serialNumber: diagnostic.serialNumber,
  };

  await handler(request, ack);
  assert.deepEqual(responses.pop(), { ok: false, error: 'La estación no está autenticada.' });
  assert.equal(reads, 0);

  authorized = true;
  await handler(request, ack);
  assert.deepEqual(responses.pop(), { ok: true, diagnostic });
  assert.equal(reads, 1);
});

test('diagnostic request handler rejects invalid payloads without invoking ADB', async () => {
  let reads = 0;
  const handler = createDiagnosticRequestHandler(
    { async diagnose() { reads += 1; return diagnostic; } },
    () => true,
  );
  let response: { ok: boolean; error?: string } | undefined;
  await handler({ requestId: 'bad', serialNumber: 'SERIAL-1' }, (value) => {
    response = value;
  });

  assert.deepEqual(response, { ok: false, error: 'Solicitud de diagnóstico inválida.' });
  assert.equal(reads, 0);
});

test('diagnostic request handler reports device errors to the requester and logs them', async () => {
  const logged: string[] = [];
  const handler = createDiagnosticRequestHandler(
    { async diagnose() { throw new Error('device unauthorized'); } },
    () => true,
    (message) => logged.push(message),
  );
  let response: { ok: boolean; error?: string } | undefined;
  await handler({
    requestId: '00000000-0000-4000-8000-000000000001',
    serialNumber: 'SERIAL-1',
  }, (value) => {
    response = value;
  });

  assert.deepEqual(response, { ok: false, error: 'device unauthorized' });
  assert.deepEqual(logged, ['No se pudo diagnosticar SERIAL-1: device unauthorized']);
});
