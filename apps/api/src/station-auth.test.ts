import assert from 'node:assert/strict';
import test from 'node:test';
import { isStationTokenValid, parseStationTokens } from './station-auth';
import { RegisterStationSchema } from '@samsung-maintenance/shared';

test('parseStationTokens loads unique station credentials from JSON', () => {
  const firstToken = 'a'.repeat(32);
  const secondToken = 'b'.repeat(32);
  const tokens = parseStationTokens(
    JSON.stringify({ WORKSTATION: firstToken, SECOND: secondToken }),
  );
  assert.equal(tokens.get('WORKSTATION'), firstToken);
  assert.equal(tokens.get('SECOND'), secondToken);
});

test('parseStationTokens rejects malformed configuration', () => {
  assert.throws(() => parseStationTokens('{bad json'));
  assert.throws(() => parseStationTokens('[]'));
  assert.throws(() => parseStationTokens('{"WORKSTATION":"short"}'));
});

test('station registration requires a configured name and non-empty token', () => {
  assert.equal(
    RegisterStationSchema.safeParse({
      stationName: 'WORKSTATION',
      token: 'a'.repeat(32),
    }).success,
    true,
  );
  assert.equal(
    RegisterStationSchema.safeParse({
      stationName: ' ',
      token: 'a'.repeat(32),
    }).success,
    false,
  );
  assert.equal(
    RegisterStationSchema.safeParse({ stationName: 'WORKSTATION', token: '' }).success,
    false,
  );
});

test('station token comparison rejects missing, wrong, and different-length tokens', () => {
  const token = 'a'.repeat(32);
  assert.equal(isStationTokenValid(undefined, token), false);
  assert.equal(isStationTokenValid(token, 'b'.repeat(32)), false);
  assert.equal(isStationTokenValid(token, 'b'.repeat(33)), false);
  assert.equal(isStationTokenValid(token, token), true);
});
