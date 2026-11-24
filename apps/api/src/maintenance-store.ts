import { PrismaClient, Role } from '@prisma/client';

export interface MaintenanceDevice {
  id: string;
  serialNumber: string;
  state: string;
  manufacturer: string | null;
  station: { id: string; isRegistered: boolean } | null;
}

export interface MaintenanceRecord {
  id: string;
  type: string;
  status: string;
  details: string | null;
  createdAt: Date;
  user: { id: string; name: string; email: string; role: Role };
}

export interface MaintenanceStore {
  findDevice(id: string): Promise<MaintenanceDevice | null>;
  createOperation(input: {
    type: string;
    deviceId: string;
    stationId: string;
    userId: string;
  }): Promise<{ id: string; createdAt: Date }>;
  completeOperation(id: string, status: string, details: string): Promise<void>;
  listOperations(deviceId: string): Promise<MaintenanceRecord[]>;
}

export class PrismaMaintenanceStore implements MaintenanceStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findDevice(id: string): Promise<MaintenanceDevice | null> {
    return this.prisma.device.findUnique({
      where: { id },
      select: {
        id: true,
        serialNumber: true,
        state: true,
        manufacturer: true,
        station: { select: { id: true, isRegistered: true } },
      },
    });
  }

  async createOperation(input: {
    type: string;
    deviceId: string;
    stationId: string;
    userId: string;
  }): Promise<{ id: string; createdAt: Date }> {
    return this.prisma.$transaction(async (transaction) => {
      const operation = await transaction.operationHistory.create({
        data: {
          ...input,
          status: 'PENDING',
          details: JSON.stringify({ result: 'Solicitud confirmada por el técnico.' }),
        },
        select: { id: true, createdAt: true },
      });
      await transaction.auditLog.create({
        data: {
          action: 'DEVICE_MAINTENANCE_REQUESTED',
          target: input.deviceId,
          details: JSON.stringify({
            operationId: operation.id,
            operation: input.type,
          }),
          userId: input.userId,
        },
      });
      return operation;
    });
  }

  async completeOperation(id: string, status: string, details: string): Promise<void> {
    await this.prisma.operationHistory.update({
      where: { id },
      data: { status, details },
    });
  }

  async listOperations(deviceId: string): Promise<MaintenanceRecord[]> {
    return this.prisma.operationHistory.findMany({
      where: { deviceId },
      select: {
        id: true,
        type: true,
        status: true,
        details: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
