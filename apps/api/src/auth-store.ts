import { Prisma, PrismaClient, Role as PrismaRole } from '@prisma/client';
import {
  CreateUserInput,
  UpdateStationInput,
  UpdateUserInput,
  UserRole,
} from '@samsung-maintenance/shared';
import { AuthenticatedUser } from './auth-types';

export interface UserCredential extends AuthenticatedUser {
  password: string;
}

export interface SessionRecord {
  id: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: AuthenticatedUser;
}

export interface AdminSession {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  user: Pick<AuthenticatedUser, 'id' | 'email' | 'name' | 'role' | 'isActive'>;
}

export interface AuditEntry {
  id: string;
  action: string;
  target: string;
  details: string | null;
  createdAt: Date;
  user: Pick<AuthenticatedUser, 'id' | 'email' | 'name' | 'role'>;
}

export interface AdminStation {
  id: string;
  name: string;
  machineName: string;
  ipAddress: string | null;
  isRegistered: boolean;
  createdAt: Date;
}

export interface DashboardSummary {
  stations: number;
  devices: number;
  users: number;
  activeUsers: number;
  activeSessions: number;
  operations: number;
  auditEntries: number;
}

export interface AuthStore {
  findUserByEmail(email: string): Promise<UserCredential | null>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  revokeSession(id: string, revokedAt: Date): Promise<void>;
}

export interface UserStore extends AuthStore {
  listUsers(): Promise<AuthenticatedUser[]>;
  createUser(
    actorId: string,
    input: Omit<CreateUserInput, 'password'> & { password: string },
  ): Promise<AuthenticatedUser>;
  updateUser(
    targetId: string,
    actorId: string,
    input: UpdateUserInput & { password?: string },
  ): Promise<AuthenticatedUser | null>;
  listSessions(): Promise<AdminSession[]>;
  listAuditEntries(): Promise<AuditEntry[]>;
  revokeSessionByAdmin(id: string, actorId: string): Promise<boolean>;
  updateStation(
    id: string,
    actorId: string,
    input: UpdateStationInput,
  ): Promise<AdminStation | null>;
  getDashboardSummary(): Promise<DashboardSummary>;
  createInitialAdmin(input: {
    email: string;
    name: string;
    password: string;
  }): Promise<AuthenticatedUser>;
}

const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

const roleMap: Record<UserRole, PrismaRole> = {
  [UserRole.ADMIN]: PrismaRole.ADMIN,
  [UserRole.SUPERVISOR]: PrismaRole.SUPERVISOR,
  [UserRole.TECHNICIAN]: PrismaRole.TECHNICIAN,
};

export class PrismaAuthStore implements UserStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findUserByEmail(email: string): Promise<UserCredential | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { ...publicUserSelect, password: true },
    });
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.prisma.authSession.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: publicUserSelect },
      },
    });
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const session = await transaction.authSession.create({
        data: { userId, tokenHash, expiresAt },
        select: { id: true },
      });
      await transaction.auditLog.create({
        data: {
          action: 'AUTH_LOGIN',
          target: session.id,
          userId,
        },
      });
    });
  }

  async revokeSession(id: string, revokedAt: Date): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.authSession.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt },
      });
      if (result.count > 0) {
        const session = await transaction.authSession.findUnique({
          where: { id },
          select: { userId: true },
        });
        if (session) {
          await transaction.auditLog.create({
            data: {
              action: 'AUTH_LOGOUT',
              target: id,
              userId: session.userId,
            },
          });
        }
      }
    });
  }

  async revokeUserSessions(userId: string, revokedAt: Date): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    });
  }

  async listUsers(): Promise<AuthenticatedUser[]> {
    return this.prisma.user.findMany({
      select: publicUserSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async createUser(
    actorId: string,
    input: Omit<CreateUserInput, 'password'> & { password: string },
  ): Promise<AuthenticatedUser> {
    return this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: { ...input, role: roleMap[input.role] },
        select: publicUserSelect,
      });
      await transaction.auditLog.create({
        data: {
          action: 'USER_CREATED',
          target: user.id,
          details: JSON.stringify({ role: user.role }),
          userId: actorId,
        },
      });
      return user;
    });
  }

  async updateUser(
    targetId: string,
    actorId: string,
    input: UpdateUserInput & { password?: string },
  ): Promise<AuthenticatedUser | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        const current = await transaction.user.findUnique({
          where: { id: targetId },
          select: { id: true, role: true, isActive: true },
        });
        if (!current) return null;

        const changesRole =
          input.role !== undefined && roleMap[input.role] !== current.role;
        const disablesUser = input.isActive === false && current.isActive;
        if (targetId === actorId && (changesRole || disablesUser)) {
          throw new UserStoreError('SELF_PRIVILEGE_CHANGE');
        }

        if (
          current.role === PrismaRole.ADMIN &&
          current.isActive &&
          ((input.role !== undefined &&
            roleMap[input.role] !== PrismaRole.ADMIN) ||
            disablesUser)
        ) {
          const activeAdmins = await transaction.user.count({
            where: { role: PrismaRole.ADMIN, isActive: true },
          });
          if (activeAdmins <= 1) throw new UserStoreError('LAST_ACTIVE_ADMIN');
        }

        const { role, ...rest } = input;
        const updated = await transaction.user.update({
          where: { id: targetId },
          data: {
            ...rest,
            ...(role !== undefined ? { role: roleMap[role] } : {}),
          },
          select: publicUserSelect,
        });

        await transaction.auditLog.create({
          data: {
            action: 'USER_UPDATED',
            target: targetId,
            details: JSON.stringify({
              fields: Object.keys(input).filter((field) => field !== 'password'),
              passwordChanged: input.password !== undefined,
            }),
            userId: actorId,
          },
        });

        if (input.password !== undefined || disablesUser) {
          await transaction.authSession.updateMany({
            where: { userId: targetId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }

        return updated;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listSessions(): Promise<AdminSession[]> {
    return this.prisma.authSession.findMany({
      select: {
        id: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async listAuditEntries(): Promise<AuditEntry[]> {
    return this.prisma.auditLog.findMany({
      select: {
        id: true,
        action: true,
        target: true,
        details: true,
        createdAt: true,
        user: {
          select: { id: true, email: true, name: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async revokeSessionByAdmin(id: string, actorId: string): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const session = await transaction.authSession.findUnique({
        where: { id },
        select: { id: true, userId: true, revokedAt: true },
      });
      if (!session) return false;

      const result = session.revokedAt
        ? { count: 0 }
        : await transaction.authSession.updateMany({
            where: { id, revokedAt: null },
            data: { revokedAt: new Date() },
          });
      if (result.count > 0) {
        await transaction.auditLog.create({
          data: {
            action: 'ADMIN_REVOKED_SESSION',
            target: id,
            details: JSON.stringify({ sessionUserId: session.userId }),
            userId: actorId,
          },
        });
      }
      return true;
    });
  }

  async updateStation(
    id: string,
    actorId: string,
    input: UpdateStationInput,
  ): Promise<AdminStation | null> {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.station.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!current) return null;

      const station = await transaction.station.update({
        where: { id },
        data: {
          ...(input.machineName !== undefined
            ? { machineName: input.machineName }
            : {}),
          ...(input.ipAddress !== undefined ? { ipAddress: input.ipAddress } : {}),
          ...(input.isRegistered !== undefined
            ? { isRegistered: input.isRegistered }
            : {}),
        },
        select: {
          id: true,
          name: true,
          machineName: true,
          ipAddress: true,
          isRegistered: true,
          createdAt: true,
        },
      });
      await transaction.auditLog.create({
        data: {
          action: 'STATION_UPDATED',
          target: station.id,
          details: JSON.stringify({ fields: Object.keys(input) }),
          userId: actorId,
        },
      });
      return station;
    });
  }

  async getDashboardSummary(): Promise<DashboardSummary> {
    const [
      stations,
      devices,
      users,
      activeUsers,
      activeSessions,
      operations,
      auditEntries,
    ] = await this.prisma.$transaction([
      this.prisma.station.count(),
      this.prisma.device.count(),
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.authSession.count({
        where: {
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      }),
      this.prisma.operationHistory.count(),
      this.prisma.auditLog.count(),
    ]);

    return {
      stations,
      devices,
      users,
      activeUsers,
      activeSessions,
      operations,
      auditEntries,
    };
  }

  async createInitialAdmin(input: {
    email: string;
    name: string;
    password: string;
  }): Promise<AuthenticatedUser> {
    return this.prisma.$transaction(
      async (transaction) => {
        const userCount = await transaction.user.count();
        if (userCount !== 0) throw new UserStoreError('BOOTSTRAP_ALREADY_COMPLETED');

        const user = await transaction.user.create({
          data: { ...input, role: PrismaRole.ADMIN, isActive: true },
          select: publicUserSelect,
        });
        await transaction.auditLog.create({
          data: {
            action: 'INITIAL_ADMIN_CREATED',
            target: user.id,
            userId: user.id,
          },
        });
        return user;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}

export class UserStoreError extends Error {
  constructor(
    readonly code:
      | 'SELF_PRIVILEGE_CHANGE'
      | 'LAST_ACTIVE_ADMIN'
      | 'BOOTSTRAP_ALREADY_COMPLETED',
  ) {
    super(code);
  }
}
