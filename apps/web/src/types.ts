import type {
  DeviceDiagnostic,
  MaintenanceOperation,
  UserRole,
} from '@samsung-maintenance/shared';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Station {
  id: string;
  name: string;
  machineName: string;
  ipAddress?: string | null;
  isRegistered: boolean;
  createdAt: string;
  devices?: Array<{ id: string }>;
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

export interface Device {
  id: string;
  serialNumber: string;
  model: string | null;
  manufacturer: string | null;
  buildNumber: string | null;
  state: string;
  androidVersion: string | null;
  batteryLevel: number | null;
  station?: Station | null;
}

export interface DeviceDiagnosticRecord {
  id: string;
  status: 'PENDING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
  result: DeviceDiagnostic | null;
  errors: string[];
  createdAt: string;
  completedAt: string | null;
  user: { id: string; name: string; email: string };
}

export interface MaintenanceRecord {
  id: string;
  type: MaintenanceOperation | string;
  status: string;
  details: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string; role: UserRole };
}

export interface UserListItem extends AuthenticatedUser {}

export interface AdminSession {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  user: Pick<AuthenticatedUser, 'id' | 'email' | 'name' | 'role' | 'isActive'>;
}

export interface AuditEntry {
  id: string;
  action: string;
  target: string;
  details: string | null;
  createdAt: string;
  user: Pick<AuthenticatedUser, 'id' | 'email' | 'name' | 'role'>;
}
