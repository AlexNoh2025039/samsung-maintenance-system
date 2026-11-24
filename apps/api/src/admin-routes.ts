import { Router } from 'express';
import { UpdateStationSchema } from '@samsung-maintenance/shared';
import { UserStore } from './auth-store';

export function createAdminRouter(store: UserStore): Router {
  const router = Router();

  router.get('/dashboard', async (_request, response) => {
    try {
      response.json({ summary: await store.getDashboardSummary() });
    } catch (error) {
      console.error('Error al consultar el resumen:', error);
      response.status(500).json({ error: 'No se pudo consultar el resumen.' });
    }
  });

  router.get('/sessions', async (_request, response) => {
    try {
      response.json({ sessions: await store.listSessions() });
    } catch (error) {
      console.error('Error al consultar sesiones:', error);
      response.status(500).json({ error: 'No se pudieron consultar las sesiones.' });
    }
  });

  router.delete('/sessions/:id', async (request, response) => {
    if (!request.authUser) {
      response.status(401).json({ error: 'Autenticación requerida.' });
      return;
    }
    if (!request.params.id || request.params.id.length > 128) {
      response.status(400).json({ error: 'El identificador de sesión no es válido.' });
      return;
    }

    try {
      const revoked = await store.revokeSessionByAdmin(
        request.params.id,
        request.authUser.id,
      );
      if (!revoked) {
        response.status(404).json({ error: 'Sesión no encontrada.' });
        return;
      }
      response.status(204).end();
    } catch (error) {
      console.error('Error al revocar sesión:', error);
      response.status(500).json({ error: 'No se pudo revocar la sesión.' });
    }
  });

  router.get('/audit', async (_request, response) => {
    try {
      response.json({ entries: await store.listAuditEntries() });
    } catch (error) {
      console.error('Error al consultar auditoría:', error);
      response.status(500).json({ error: 'No se pudo consultar la auditoría.' });
    }
  });

  router.patch('/stations/:id', async (request, response) => {
    if (!request.authUser) {
      response.status(401).json({ error: 'Autenticación requerida.' });
      return;
    }
    if (!request.params.id || request.params.id.length > 128) {
      response.status(400).json({ error: 'El identificador de estación no es válido.' });
      return;
    }
    const parsed = UpdateStationSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: 'Los datos de la estación no son válidos.' });
      return;
    }

    try {
      const station = await store.updateStation(
        request.params.id,
        request.authUser.id,
        parsed.data,
      );
      if (!station) {
        response.status(404).json({ error: 'Estación no encontrada.' });
        return;
      }
      response.json({ station });
    } catch (error) {
      console.error('Error al actualizar estación:', error);
      response.status(500).json({ error: 'No se pudo actualizar la estación.' });
    }
  });

  return router;
}
