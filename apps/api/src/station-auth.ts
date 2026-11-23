import { timingSafeEqual } from 'node:crypto';

export function parseStationTokens(rawTokens: string | undefined): Map<string, string> {
  if (!rawTokens) return new Map();

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawTokens);
  } catch {
    throw new Error('STATION_TOKENS must be a JSON object of station names to tokens.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('STATION_TOKENS must be a JSON object of station names to tokens.');
  }

  const tokens = new Map<string, string>();
  for (const [stationName, token] of Object.entries(parsed)) {
    if (!stationName.trim() || typeof token !== 'string' || token.length < 32) {
      throw new Error('STATION_TOKENS contains an invalid station name or token.');
    }
    tokens.set(stationName, token);
  }

  return tokens;
}

export function isStationTokenValid(
  expectedToken: string | undefined,
  providedToken: string,
): boolean {
  if (!expectedToken) return false;

  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(providedToken);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
