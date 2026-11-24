import { Router } from 'express';
import { CreateUserSchema, UpdateUserSchema } from '@samsung-maintenance/shared';
import { UserStore, UserStoreError } from './auth-store';
import { hashPassword } from './password';

export function createUserRouter(store: UserStore): Router {
  const router = Router();

  router.get('/', async (request, response) => {
    try {
      response.json({ users: await store.listUsers() });
    } catch (error) {
      console.error('Error al consultar usuarios:', error);
      response.status(500).json({ error: 'No se pudieron consultar los usuarios.' });
    }
  });

  router.post('/', async (request, response) => {
    const parsed = CreateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Los datos del usuario no son válidos.' });
      return;
    }

    try {
      const password = await hashPassword(parsed.data.password);
      const user = await store.createUser({ ...parsed.data, password });
      response.status(201).json({ user });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        response.status(409).json({ error: 'Ya existe un usuario con ese correo.' });
        return;
      }
      console.error('Error al crear usuario:', error);
      response.status(500).json({ error: 'No se pudo crear el usuario.' });
    }
  });

  router.patch('/:id', async (request, response) => {
    const parsed = UpdateUserSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Los datos del usuario no son válidos.' });
      return;
    }
    if (!request.authUser) {
      response.status(401).json({ error: 'Autenticación requerida.' });
      return;
    }

    try {
      const data = {
        ...parsed.data,
        ...(parsed.data.password
          ? { password: await hashPassword(parsed.data.password) }
          : {}),
      };
      const user = await store.updateUser(request.params.id, request.authUser.id, data);
      if (!user) {
        response.status(404).json({ error: 'Usuario no encontrado.' });
        return;
      }
      response.json({ user });
    } catch (error) {
      if (error instanceof UserStoreError) {
        if (error.code === 'SELF_PRIVILEGE_CHANGE') {
          response.status(403).json({ error: 'No puedes cambiar tu propio rol o desactivar tu cuenta.' });
          return;
        }
        if (error.code === 'LAST_ACTIVE_ADMIN') {
          response.status(409).json({ error: 'Debe permanecer al menos un administrador activo.' });
          return;
        }
      }
      if (isUniqueConstraintError(error)) {
        response.status(409).json({ error: 'Ya existe un usuario con ese correo.' });
        return;
      }
      console.error('Error al actualizar usuario:', error);
      response.status(500).json({ error: 'No se pudo actualizar el usuario.' });
    }
  });

  return router;
}
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}
