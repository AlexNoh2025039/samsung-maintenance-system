import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import test from 'node:test';
import { AddressInfo } from 'node:net';
import { Role } from '@prisma/client';
import { UserRole } from '@samsung-maintenance/shared';
import { AuthenticatedUser } from './auth-types';
import {
  AdminSession,
  AdminStation,
  AuditEntry,
  AuthStore,
  SessionRecord,
  UserCredential,
  UserStore,
  UserStoreError,
} from './auth-store';
import { createAuthRouter } from './auth-routes';
import { createRequireAuth, requireRoles } from './auth-middleware';
import { createUserRouter } from './user-routes';
import { createAdminRouter } from './admin-routes';
import { hashPassword } from './password';

const PASSWORD = 'a-secure-password-123';
const PASSWORD_HASH_PROMISE = hashPassword(PASSWORD);

function createUser(
  id: string,
  role: Role,
  overrides: Partial<AuthenticatedUser> = {},
): UserCredential {
  const now = new Date();
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    password: '',
    role,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createStore(initialUsers: UserCredential[]): UserStore {
  const users = new Map(initialUsers.map((user) => [user.id, user]));
  const sessions = new Map<string, SessionRecord>();
  const audits: AuditEntry[] = [];

  const store: UserStore = {
    async findUserByEmail(email) {
      return [...users.values()].find((user) => user.email === email) ?? null;
    },
    async findSessionByTokenHash(tokenHash) {
      return sessions.get(tokenHash) ?? null;
    },
    async createSession(userId, tokenHash, expiresAt) {
      const user = users.get(userId);
      if (!user) throw new Error('test user missing');
      sessions.set(tokenHash, {
        id: `session-${tokenHash}`,
        expiresAt,
        revokedAt: null,
        user,
      });
    },
    async revokeSession(id, revokedAt) {
      for (const session of sessions.values()) {
        if (session.id === id) session.revokedAt = revokedAt;
      }
    },
    async revokeUserSessions(userId, revokedAt) {
      for (const session of sessions.values()) {
        if (session.user.id === userId) session.revokedAt = revokedAt;
      }
    },
    async listSessions(): Promise<AdminSession[]> {
      return [...sessions.values()].map((session) => ({
        id: session.id,
        createdAt: new Date(),
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt,
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          role: session.user.role,
          isActive: session.user.isActive,
        },
      }));
    },
    async listAuditEntries() {
      return audits;
    },
    async revokeSessionByAdmin(id, actorId) {
      const session = [...sessions.values()].find((item) => item.id === id);
      if (!session) return false;
      if (!session.revokedAt) {
        session.revokedAt = new Date();
        audits.push({
          id: `audit-${audits.length + 1}`,
          action: 'ADMIN_REVOKED_SESSION',
          target: id,
          details: null,
          createdAt: new Date(),
          user: {
            id: actorId,
            email: users.get(actorId)!.email,
            name: users.get(actorId)!.name,
            role: users.get(actorId)!.role,
          },
        });
      }
      return true;
    },
    async updateStation(id, actorId, input): Promise<AdminStation | null> {
      if (id !== 'station-1') return null;
      const station = {
        id,
        name: 'station-1',
        machineName: input.machineName ?? 'station-1',
        ipAddress: input.ipAddress ?? null,
        isRegistered: input.isRegistered ?? true,
        createdAt: new Date(),
      };
      audits.push({
        id: `audit-${audits.length + 1}`,
        action: 'STATION_UPDATED',
        target: id,
        details: '{"fields":["machineName"]}',
        createdAt: new Date(),
        user: {
          id: actorId,
          email: users.get(actorId)!.email,
          name: users.get(actorId)!.name,
          role: users.get(actorId)!.role,
        },
      });
      return station;
    },
    async getDashboardSummary() {
      const activeSessions = [...sessions.values()].filter(
        (session) => session.revokedAt === null && session.expiresAt.getTime() > Date.now(),
      ).length;
      const activeUsers = [...users.values()].filter((user) => user.isActive).length;
      return {
        stations: 1,
        devices: 0,
        users: users.size,
        activeUsers,
        activeSessions,
        operations: 0,
        auditEntries: audits.length,
      };
    },
    async listUsers() {
      return [...users.values()].map(toPublicUser);
    },
    async createUser(_actorId, input) {
      const user = createUser(
        `user-${users.size + 1}`,
        input.role === UserRole.ADMIN
          ? Role.ADMIN
          : input.role === UserRole.SUPERVISOR
            ? Role.SUPERVISOR
            : Role.TECHNICIAN,
        { email: input.email, name: input.name, password: input.password },
      );
      users.set(user.id, user);
      return toPublicUser(user);
    },
    async updateUser(targetId, actorId, input) {
      const user = users.get(targetId);
      if (!user) return null;

      const requestedRole =
        input.role === UserRole.ADMIN
          ? Role.ADMIN
          : input.role === UserRole.SUPERVISOR
            ? Role.SUPERVISOR
            : input.role === UserRole.TECHNICIAN
              ? Role.TECHNICIAN
              : user.role;
      const changesRole = requestedRole !== user.role;
      const disablesUser = input.isActive === false && user.isActive;
      if (targetId === actorId && (changesRole || disablesUser)) {
        throw new UserStoreError('SELF_PRIVILEGE_CHANGE');
      }
      if (
        user.role === Role.ADMIN &&
        user.isActive &&
        (requestedRole !== Role.ADMIN || disablesUser) &&
        [...users.values()].filter((item) => item.role === Role.ADMIN && item.isActive)
          .length === 1
      ) {
        throw new UserStoreError('LAST_ACTIVE_ADMIN');
      }

      Object.assign(user, input, { role: requestedRole, updatedAt: new Date() });
      if (input.password !== undefined || disablesUser) {
        await store.revokeUserSessions(user.id, new Date());
      }
      return toPublicUser(user);
    },
    async createInitialAdmin(input) {
      if (users.size > 0) throw new UserStoreError('BOOTSTRAP_ALREADY_COMPLETED');
      return store.createUser('bootstrap-admin', {
        ...input,
        role: UserRole.ADMIN,
      });
    },
  };

  return store;
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

async function startApp(users: UserCredential[]) {
  const store: UserStore = createStore(users);
  const requireAuth = createRequireAuth(store);
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(store, requireAuth, 1));
  app.use(
    '/api/users',
    requireAuth,
    requireRoles(Role.ADMIN),
    createUserRouter(store),
  );
  app.use('/api/admin', requireAuth, requireRoles(Role.ADMIN), createAdminRouter(store));
  app.get('/admin-only', requireAuth, requireRoles(Role.ADMIN), (_request, response) =>
    response.json({ ok: true }),
  );
  app.get(
    '/supervisor-only',
    requireAuth,
    requireRoles(Role.ADMIN, Role.SUPERVISOR),
    (_request, response) => response.json({ ok: true }),
  );
  app.get('/maintenance', requireAuth, requireRoles(
    Role.ADMIN,
    Role.SUPERVISOR,
    Role.TECHNICIAN,
  ), (_request, response) => response.json({ ok: true }));

  const server = createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return {
    store,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
  };
}

async function login(baseUrl: string, email: string, password = PASSWORD) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

test('login accepts the correct password and never returns its hash', async () => {
  const admin = createUser('admin', Role.ADMIN, { password: await PASSWORD_HASH_PROMISE });
  const app = await startApp([admin]);
  try {
    const response = await login(app.baseUrl, admin.email);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(typeof result.token, 'string');
    assert.equal(result.user.password, undefined);
    assert.equal(result.user.role, Role.ADMIN);
  } finally {
    await app.close();
  }
});

test('incorrect password, unknown user, and inactive user receive the same auth error', async () => {
  const active = createUser('active', Role.TECHNICIAN, {
    password: await PASSWORD_HASH_PROMISE,
  });
  const inactive = createUser('inactive', Role.TECHNICIAN, {
    password: await PASSWORD_HASH_PROMISE,
    isActive: false,
  });
  const app = await startApp([active, inactive]);
  try {
    const incorrect = await login(app.baseUrl, active.email, 'wrong-password');
    const missing = await login(app.baseUrl, 'missing@example.com');
    const disabled = await login(app.baseUrl, inactive.email);
    assert.equal(incorrect.status, 401);
    const incorrectBody = await incorrect.json();
    assert.deepEqual(incorrectBody, await missing.json());
    assert.deepEqual(incorrectBody, await disabled.json());
  } finally {
    await app.close();
  }
});

test('auth endpoints require a valid session and logout revokes that session', async () => {
  const user = createUser('technician', Role.TECHNICIAN, {
    password: await PASSWORD_HASH_PROMISE,
  });
  const app = await startApp([user]);
  try {
    assert.equal((await fetch(`${app.baseUrl}/api/auth/me`)).status, 401);
    const response = await login(app.baseUrl, user.email);
    const { token } = await response.json();
    const headers = { authorization: `Bearer ${token}` };
    const me = await fetch(`${app.baseUrl}/api/auth/me`, { headers });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.id, user.id);
    assert.equal((await fetch(`${app.baseUrl}/api/users`, { headers })).status, 403);

    const logout = await fetch(`${app.baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers,
    });
    assert.equal(logout.status, 204);
    assert.equal((await fetch(`${app.baseUrl}/api/auth/me`, { headers })).status, 401);
  } finally {
    await app.close();
  }
});

test('all roles can use maintenance-authorized routes and only ADMIN can access users', async () => {
  const roles = [
    { id: 'admin', role: Role.ADMIN },
    { id: 'supervisor', role: Role.SUPERVISOR },
    { id: 'technician', role: Role.TECHNICIAN },
  ];
  const users = await Promise.all(
    roles.map(async ({ id, role }) =>
      createUser(id, role, { password: await PASSWORD_HASH_PROMISE }),
    ),
  );
  const app = await startApp(users);
  try {
    for (const user of users) {
      const response = await login(app.baseUrl, user.email);
      const { token } = await response.json();
      const headers = { authorization: `Bearer ${token}` };
      assert.equal((await fetch(`${app.baseUrl}/maintenance`, { headers })).status, 200);
      assert.equal(
        (await fetch(`${app.baseUrl}/api/users`, { headers })).status,
        user.role === Role.ADMIN ? 200 : 403,
      );
      assert.equal(
        (await fetch(`${app.baseUrl}/admin-only`, { headers })).status,
        user.role === Role.ADMIN ? 200 : 403,
      );
      assert.equal(
        (await fetch(`${app.baseUrl}/supervisor-only`, { headers })).status,
        user.role === Role.TECHNICIAN ? 403 : 200,
      );
    }
  } finally {
    await app.close();
  }
});

test('administrators cannot change their own role or disable their account', async () => {
  const admin = createUser('admin', Role.ADMIN, {
    password: await PASSWORD_HASH_PROMISE,
  });
  const app = await startApp([admin]);
  try {
    const response = await login(app.baseUrl, admin.email);
    const { token } = await response.json();
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    };
    const roleUpdate = await fetch(`${app.baseUrl}/api/users/${admin.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ role: UserRole.TECHNICIAN }),
    });
    assert.equal(roleUpdate.status, 403);

    const disable = await fetch(`${app.baseUrl}/api/users/${admin.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ isActive: false }),
    });
    assert.equal(disable.status, 403);
  } finally {
    await app.close();
  }
});

test('only administrators can create users or change another user role', async () => {
  const admin = createUser('admin', Role.ADMIN, {
    password: await PASSWORD_HASH_PROMISE,
  });
  const technician = createUser('technician', Role.TECHNICIAN, {
    password: await PASSWORD_HASH_PROMISE,
  });
  const app = await startApp([admin, technician]);
  try {
    assert.equal(
      (await fetch(`${app.baseUrl}/api/admin/sessions`)).status,
      401,
    );
    const adminLogin = await login(app.baseUrl, admin.email);
    const { token: adminToken } = await adminLogin.json();
    const technicianLogin = await login(app.baseUrl, technician.email);
    const { token: technicianToken } = await technicianLogin.json();

    const unauthorizedUpdate = await fetch(
      `${app.baseUrl}/api/users/${technician.id}`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${technicianToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ role: UserRole.ADMIN }),
      },
    );
    assert.equal(unauthorizedUpdate.status, 403);

    const authorizedUpdate = await fetch(
      `${app.baseUrl}/api/users/${technician.id}`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ role: UserRole.SUPERVISOR }),
      },
    );
    assert.equal(authorizedUpdate.status, 200);
    assert.equal((await authorizedUpdate.json()).user.role, Role.SUPERVISOR);

    const create = await fetch(`${app.baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'new-user@example.com',
        name: 'New User',
        password: 'a-secure-password',
        role: UserRole.SUPERVISOR,
      }),
    });
    assert.equal(create.status, 201);
    const created = await create.json();
    assert.equal(created.user.role, Role.SUPERVISOR);
    assert.equal('password' in created.user, false);
  } finally {
    await app.close();
  }
});

test('only ADMIN can read the real dashboard summary', async () => {
  const admin = createUser('admin', Role.ADMIN, {
    password: await PASSWORD_HASH_PROMISE,
  });
  const technician = createUser('technician', Role.TECHNICIAN, {
    password: await PASSWORD_HASH_PROMISE,
  });
  const app = await startApp([admin, technician]);
  try {
    const adminLogin = await login(app.baseUrl, admin.email);
    const { token: adminToken } = await adminLogin.json();
    const technicianLogin = await login(app.baseUrl, technician.email);
    const { token: technicianToken } = await technicianLogin.json();

    const authorized = await fetch(`${app.baseUrl}/api/admin/dashboard`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(authorized.status, 200);
    const body = await authorized.json();
    assert.equal(body.summary.stations, 1);
    assert.equal(body.summary.users, 2);
    assert.equal(body.summary.activeUsers, 2);

    const forbidden = await fetch(`${app.baseUrl}/api/admin/dashboard`, {
      headers: { authorization: `Bearer ${technicianToken}` },
    });
    assert.equal(forbidden.status, 403);
  } finally {
    await app.close();
  }
});

test('issued session tokens are random and stored only as a hash', async () => {
  const user = createUser('admin', Role.ADMIN, {
    password: await PASSWORD_HASH_PROMISE,
  });

  test('only ADMIN can inspect audit and sessions or revoke a session', async () => {
    const admin = createUser('admin', Role.ADMIN, {
      password: await PASSWORD_HASH_PROMISE,
    });

    test('only ADMIN can update station metadata and invalid inputs are rejected', async () => {
      const admin = createUser('admin', Role.ADMIN, {
        password: await PASSWORD_HASH_PROMISE,
      });
      const technician = createUser('technician', Role.TECHNICIAN, {
        password: await PASSWORD_HASH_PROMISE,
      });
      const app = await startApp([admin, technician]);
      try {
        const adminLogin = await login(app.baseUrl, admin.email);
        const { token: adminToken } = await adminLogin.json();
        const technicianLogin = await login(app.baseUrl, technician.email);
        const { token: technicianToken } = await technicianLogin.json();
        const adminHeaders = {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        };

        const updated = await fetch(`${app.baseUrl}/api/admin/stations/station-1`, {
          method: 'PATCH',
          headers: adminHeaders,
          body: JSON.stringify({ machineName: 'Taller Norte' }),
        });
        assert.equal(updated.status, 200);
        assert.equal((await updated.json()).station.machineName, 'Taller Norte');

        const invalid = await fetch(`${app.baseUrl}/api/admin/stations/station-1`, {
          method: 'PATCH',
          headers: adminHeaders,
          body: JSON.stringify({ machineName: '' }),
        });
        assert.equal(invalid.status, 400);

        const forbidden = await fetch(`${app.baseUrl}/api/admin/stations/station-1`, {
          method: 'PATCH',
          headers: {
            authorization: `Bearer ${technicianToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ machineName: 'No autorizado' }),
        });
        assert.equal(forbidden.status, 403);
        assert.equal((await app.store.listAuditEntries())[0]?.action, 'STATION_UPDATED');
      } finally {
        await app.close();
      }
    });
    const technician = createUser('technician', Role.TECHNICIAN, {
      password: await PASSWORD_HASH_PROMISE,
    });
    const app = await startApp([admin, technician]);
    try {
      const adminLogin = await login(app.baseUrl, admin.email);
      const { token: adminToken } = await adminLogin.json();
      const techLogin = await login(app.baseUrl, technician.email);
      const { token: techToken } = await techLogin.json();
      const adminHeaders = { authorization: `Bearer ${adminToken}` };
      const techHeaders = { authorization: `Bearer ${techToken}` };

      const sessions = await fetch(`${app.baseUrl}/api/admin/sessions`, {
        headers: adminHeaders,
      });
      assert.equal(sessions.status, 200);
      const sessionItems = (await sessions.json()).sessions as AdminSession[];
      const technicianSession = sessionItems.find((item) => item.user.id === technician.id);
      assert.ok(technicianSession);
      assert.equal('tokenHash' in technicianSession, false);

      assert.equal(
        (await fetch(`${app.baseUrl}/api/admin/audit`, { headers: adminHeaders })).status,
        200,
      );
      assert.equal(
        (await fetch(`${app.baseUrl}/api/admin/sessions`, { headers: techHeaders })).status,
        403,
      );

      const revoked = await fetch(
        `${app.baseUrl}/api/admin/sessions/${technicianSession.id}`,
        { method: 'DELETE', headers: adminHeaders },
      );
      assert.equal(revoked.status, 204);
      assert.equal(
        (await fetch(`${app.baseUrl}/api/auth/me`, { headers: techHeaders })).status,
        401,
      );
      assert.equal((await app.store.listAuditEntries())[0]?.action, 'ADMIN_REVOKED_SESSION');
    } finally {
      await app.close();
    }
  });
  const app = await startApp([user]);
  try {
    const response = await login(app.baseUrl, user.email);
    const { token } = await response.json();
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const stored = await app.store.findSessionByTokenHash(tokenHash);
    assert.ok(stored);
    assert.notEqual(stored.id, token);
    assert.ok(stored.expiresAt.getTime() > Date.now());
  } finally {
    await app.close();
  }
});
