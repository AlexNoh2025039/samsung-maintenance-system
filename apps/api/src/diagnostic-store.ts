import { DiagnosticStatus, PrismaClient } from '@prisma/client';

export interface DiagnosticDevice {
  id: string;
  serialNumber: string;
  state: string;
  stationId: string | null;
  station: { id: string; isRegistered: boolean } | null;
}

export interface DiagnosticRecord {
  id: string;
  status: DiagnosticStatus;
  result: string | null;
  errors: string | null;
  createdAt: Date;
  completedAt: Date | null;
  user: { id: string; name: string; email: string };
}

export interface DiagnosticStore {
  findDevice(id: string): Promise<DiagnosticDevice | null>;
  createDiagnostic(input: {
    deviceId: string;
    stationId: string;
    userId: string;
  }): Promise<{ id: string; createdAt: Date }>;
  completeDiagnostic(
    id: string,
    status: DiagnosticStatus,
    result: string | null,
    errors: string[],
  ): Promise<void>;
  listDiagnostics(deviceId: string): Promise<DiagnosticRecord[]>;
}

export class PrismaDiagnosticStore implements DiagnosticStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findDevice(id: string): Promise<DiagnosticDevice | null> {
    return this.prisma.device.findUnique({
      where: { id },
      select: {
        id: true,
        serialNumber: true,
        state: true,
        stationId: true,
        station: { select: { id: true, isRegistered: true } },
      },
    });
  }

  async createDiagnostic(input: {
    deviceId: string;
    stationId: string;
    userId: string;
  }): Promise<{ id: string; createdAt: Date }> {
    return this.prisma.$transaction(async (transaction) => {
      const record = await transaction.deviceDiagnostic.create({
        data: { ...input },
        select: { id: true, createdAt: true },
      });
      await transaction.auditLog.create({
        data: {
          action: 'DEVICE_DIAGNOSTIC_REQUESTED',
          target: input.deviceId,
          details: JSON.stringify({ diagnosticId: record.id }),
          userId: input.userId,
        },
      });
      return record;
    });
  }

  async completeDiagnostic(
    id: string,
    status: DiagnosticStatus,
    result: string | null,
    errors: string[],
  ): Promise<void> {
    await this.prisma.deviceDiagnostic.update({
      where: { id },
      data: {
        status,
        result,
        errors: errors.length > 0 ? JSON.stringify(errors) : null,
        completedAt: new Date(),
      },
    });
  }

  async listDiagnostics(deviceId: string): Promise<DiagnosticRecord[]> {
    return this.prisma.deviceDiagnostic.findMany({
      where: { deviceId },
      select: {
        id: true,
        status: true,
        result: true,
        errors: true,
        createdAt: true,
        completedAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
