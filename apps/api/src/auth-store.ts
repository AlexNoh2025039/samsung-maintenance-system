import { Prisma, PrismaClient, Role as PrismaRole } from '@prisma/client';
import {
  CreateUserInput,
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

export interface AuthStore {
  findUserByEmail(email: string): Promise<UserCredential | null>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  revokeSession(id: string, revokedAt: Date): Promise<void>;
}

export interface UserStore extends AuthStore {
  listUsers(): Promise<AuthenticatedUser[]>;
  createUser(input: Omit<CreateUserInput, 'password'> & { password: string }): Promise<AuthenticatedUser>;
  updateUser(
    targetId: string,
    actorId: string,
    input: UpdateUserInput & { password?: string },
  ): Promise<AuthenticatedUser | null>;
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
    await this.prisma.authSession.create({
      data: { userId, tokenHash, expiresAt },
    });
  }

  async revokeSession(id: string, revokedAt: Date): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt },
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
    input: Omit<CreateUserInput, 'password'> & { password: string },
  ): Promise<AuthenticatedUser> {
    return this.prisma.user.create({
      data: { ...input, role: roleMap[input.role] },
      select: publicUserSelect,
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

  async createInitialAdmin(input: {
    email: string;
    name: string;
    password: string;
  }): Promise<AuthenticatedUser> {
    return this.prisma.$transaction(
      async (transaction) => {
        const userCount = await transaction.user.count();
        if (userCount !== 0) throw new UserStoreError('BOOTSTRAP_ALREADY_COMPLETED');

        return transaction.user.create({
          data: { ...input, role: PrismaRole.ADMIN, isActive: true },
          select: publicUserSelect,
        });
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
