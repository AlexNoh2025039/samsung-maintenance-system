import { createHash, randomBytes } from 'node:crypto';
import { RequestHandler, Router } from 'express';
import { LoginSchema } from '@samsung-maintenance/shared';
import { AuthStore } from './auth-store';
import { AuthenticatedUser } from './auth-types';
import { hashPassword, verifyPassword } from './password';

const dummyPasswordHash = hashPassword('timing-protection-placeholder');
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;

export function createAuthRouter(
  store: AuthStore,
  requireAuth: RequestHandler,
  sessionTtlHours: number,
): Router {
  const router = Router();
  const attempts = new Map<string, { count: number; resetAt: number }>();

  router.post('/login', (request, response, next) => {
    const now = Date.now();
    for (const [ip, attempt] of attempts) {
      if (attempt.resetAt <= now) attempts.delete(ip);
    }

    const ip = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    const attempt = attempts.get(ip);
    if (attempt && attempt.count >= MAX_LOGIN_ATTEMPTS && attempt.resetAt > now) {
      response.setHeader('Retry-After', Math.ceil((attempt.resetAt - now) / 1000));
      response.status(429).json({ error: 'Demasiados intentos. Intenta más tarde.' });
      return;
    }

    if (attempt) attempt.count += 1;
    else attempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    next();
  }, async (request, response) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Correo o contraseña inválidos.' });
      return;
    }

    try {
      const user = await store.findUserByEmail(parsed.data.email);
      const passwordHash = user?.password ?? (await dummyPasswordHash);
      const validPassword = await verifyPassword(parsed.data.password, passwordHash);
      if (!user || !user.isActive || !validPassword) {
        response.status(401).json({ error: 'Credenciales inválidas.' });
        return;
      }

      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + sessionTtlHours * 60 * 60 * 1000);
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await store.createSession(user.id, tokenHash, expiresAt);

      response.json({
        token,
        expiresAt,
        user: toPublicUser(user),
      });
    } catch (error) {
      console.error('Error al iniciar sesión:', error);
      response.status(500).json({ error: 'No se pudo iniciar sesión.' });
    }
  });

  router.get('/me', requireAuth, (request, response) => {
    response.json({ user: request.authUser });
  });

  router.post('/logout', requireAuth, async (request, response) => {
    try {
      if (request.authSessionId) {
        await store.revokeSession(request.authSessionId, new Date());
      }
      response.status(204).end();
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
      response.status(500).json({ error: 'No se pudo cerrar sesión.' });
    }
  });

  return router;
}

function toPublicUser(user: AuthenticatedUser): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
