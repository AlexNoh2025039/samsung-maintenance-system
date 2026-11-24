import { createHash } from 'node:crypto';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { Role } from '@prisma/client';
import { AuthStore } from './auth-store';

export function createRequireAuth(store: AuthStore): RequestHandler {
  return async (request: Request, response: Response, next: NextFunction) => {
    const authorization = request.header('authorization');
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
    if (!match) {
      response.status(401).json({ error: 'Autenticación requerida.' });
      return;
    }

    try {
      const tokenHash = createHash('sha256').update(match[1]).digest('hex');
      const session = await store.findSessionByTokenHash(tokenHash);
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt.getTime() <= Date.now() ||
        !session.user.isActive
      ) {
        response.status(401).json({ error: 'Sesión inválida o expirada.' });
        return;
      }

      request.authUser = session.user;
      request.authSessionId = session.id;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRoles(...roles: Role[]): RequestHandler {
  return (request, response, next) => {
    if (!request.authUser) {
      response.status(401).json({ error: 'Autenticación requerida.' });
      return;
    }
    if (!roles.includes(request.authUser.role)) {
      response.status(403).json({ error: 'Permisos insuficientes.' });
      return;
    }
    next();
  };
}
