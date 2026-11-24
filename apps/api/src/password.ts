import {
  randomBytes,
  scrypt as callbackScrypt,
  timingSafeEqual,
} from 'node:crypto';

const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    callbackScrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt);
  return `scrypt$32768$8$1$${salt.toString('base64')}$${derivedKey.toString('base64')}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  const parts = storedHash?.split('$');
  if (
    !parts ||
    parts.length !== 6 ||
    parts[0] !== 'scrypt' ||
    parts[1] !== '32768' ||
    parts[2] !== '8' ||
    parts[3] !== '1'
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(parts[4], 'base64');
    const expectedKey = Buffer.from(parts[5], 'base64');
    if (salt.length !== 16 || expectedKey.length !== KEY_LENGTH) return false;
    const derivedKey = await deriveKey(password, salt);
    return timingSafeEqual(expectedKey, derivedKey);
  } catch {
    return false;
  }
}
