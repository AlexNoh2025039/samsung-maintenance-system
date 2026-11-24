import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MaintenanceOperation, UserRole } from '@samsung-maintenance/shared';
import { api } from './api';
import { useAuth } from './auth-context';
import type {
  AdminSession,
  AuditEntry,
  DashboardSummary,
  Device,
  DeviceDiagnosticRecord,
  MaintenanceRecord,
  Station,
  UserListItem,
} from './types';
import { Alert, Button, DataTable, EmptyState, LoadingState, MetricCard, SectionHeading, StatusBadge, TableColumn } from './ui';

interface InventorySnapshot {
  stations: Station[];
  devices: Device[];
}

const defaultUserRole = 'TECHNICIAN' as UserRole;

function useInventory() {
  const { requestApi } = useAuth();
  const [inventory, setInventory] = useState<InventorySnapshot>({ stations: [], devices: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stations, devices] = await Promise.all([
        requestApi((token) => api.stations(token)),
        requestApi((token) => api.devices(token)),
      ]);
      setInventory({ stations, devices });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo cargar el inventario.');
    } finally {
      setLoading(false);
    }
  }, [requestApi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...inventory, loading, error, refresh };
}

function useDashboardSummary(enabled: boolean) {
  const { requestApi } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setLoading(true);
    void requestApi((token) => api.dashboardSummary(token))
      .then((value) => {
        if (active) setSummary(value);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [enabled, requestApi]);

  return { summary, loading };
}

function useUsers() {
  const { requestApi } = useAuth();
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await requestApi((token) => api.users(token)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron consultar los usuarios.');
    } finally {
      setLoading(false);
    }
  }, [requestApi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { users, loading, error, refresh };
}

function useAdminSessions() {
  const { requestApi } = useAuth();
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSessions(await requestApi((token) => api.adminSessions(token)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudieron consultar las sesiones.');
    } finally {
      setLoading(false);
    }
  }, [requestApi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { sessions, loading, error, refresh };
}

function useAuditEntries() {
  const { requestApi } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await requestApi((token) => api.auditEntries(token)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo consultar la auditoría.');
    } finally {
      setLoading(false);
    }
  }, [requestApi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { entries, loading, error, refresh };
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="error-panel">
      <Alert>{message}</Alert>
      <Button variant="secondary" onClick={onRetry}>Reintentar</Button>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { stations, devices, loading, error, refresh } = useInventory();
  const { summary, loading: summaryLoading } = useDashboardSummary(user?.role === 'ADMIN');

  const stationColumns: TableColumn<Station>[] = [
    { key: 'name', title: 'Estación', render: (station) => <strong className="table-primary">{station.name}</strong> },
    { key: 'machine', title: 'Equipo', render: (station) => station.machineName },
    {
      key: 'devices',
      title: 'Dispositivos conectados',
      render: (station) => devices.filter((device) => device.station?.id === station.id).length,
    },
    {
      key: 'state',
      title: 'Registro',
      render: (station) => (
        <StatusBadge tone={station.isRegistered ? 'success' : 'warning'}>
          {station.isRegistered ? 'Registrada' : 'Pendiente'}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="page-content">
      <SectionHeading
        eyebrow="Vista general"
        title={`Hola, ${user?.name}`}
        description="Resumen de estaciones y dispositivos registrados en el sistema."
      />
      {error && <ErrorPanel message={error} onRetry={() => void refresh()} />}
      <section className="metrics-grid" aria-label="Indicadores del inventario">
        <MetricCard
          label="Estaciones"
          value={loading ? '—' : stations.length}
          caption="Total registradas"
          accent="blue"
        />
        <MetricCard
          label="Dispositivos"
          value={loading ? '—' : devices.length}
          caption="Total en inventario"
          accent="teal"
        />
        {user?.role === 'ADMIN' && (
          <MetricCard
            label="Sesiones activas"
            value={summaryLoading ? '—' : summary?.activeSessions ?? 0}
            caption={`${summary?.activeUsers ?? 0} usuarios activos`}
            accent="blue"
          />
        )}
        <article className="profile-card">
          <span className="profile-avatar" aria-hidden="true">{user?.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <p>Sesión activa</p>
            <strong>{user?.name}</strong>
            <span>{roleTitle(user?.role)}</span>
          </div>
          <span className="profile-active"><i /> Activa</span>
        </article>
      </section>

      <section className="content-card">
        <div className="content-card-heading">
          <div>
            <h2>Estaciones de trabajo</h2>
            <p>Vista rápida de las estaciones registradas.</p>
          </div>
          <Link className="text-link" to="/stations">Ver estaciones <span aria-hidden="true">→</span></Link>
        </div>
        {loading ? (
          <LoadingState label="Cargando inventario…" />
        ) : stations.length === 0 ? (
          <EmptyState title="Aún no hay estaciones" description="Cuando una estación se registre, aparecerá aquí." />
        ) : (
          <DataTable label="Estaciones de trabajo" columns={stationColumns} rows={stations.slice(0, 5)} />
        )}
      </section>
      <p className="page-footnote">Conectado como <strong>{user?.email}</strong></p>
    </div>
  );
}

export function StationsPage() {
  const { stations, devices, loading, error, refresh } = useInventory();
  const { user, requestApi } = useAuth();
  const [editingStationId, setEditingStationId] = useState<string | null>(null);
  const [machineName, setMachineName] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [isRegistered, setIsRegistered] = useState(true);
  const [savingStation, setSavingStation] = useState(false);
  const [stationActionError, setStationActionError] = useState<string | null>(null);
  const isAdmin = user?.role === 'ADMIN';

  const columns: TableColumn<Station>[] = [
    { key: 'name', title: 'Nombre de estación', render: (station) => <strong className="table-primary">{station.name}</strong> },
    { key: 'machine', title: 'Equipo', render: (station) => station.machineName },
    {
      key: 'devices',
      title: 'Dispositivos',
      render: (station) => devices.filter((device) => device.station?.id === station.id).length,
    },
    {
      key: 'registered',
      title: 'Estado',
      render: (station) => (
        <StatusBadge tone={station.isRegistered ? 'success' : 'warning'}>
          {station.isRegistered ? 'Registrada' : 'Pendiente'}
        </StatusBadge>
      ),
    },
    {
      key: 'created',
      title: 'Fecha de registro',
      render: (station) => formatDate(station.createdAt),
    },
    ...(isAdmin ? [{
      key: 'actions',
      title: 'Acciones',
      render: (station: Station) => (
        <Button
          variant="ghost"
          onClick={() => {
            setEditingStationId(station.id);
            setMachineName(station.machineName);
            setIpAddress(station.ipAddress ?? '');
            setIsRegistered(station.isRegistered);
            setStationActionError(null);
          }}
        >
          Editar equipo
        </Button>
      ),
    }] : []),
  ];

  const saveStation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingStationId) return;
    setSavingStation(true);
    setStationActionError(null);
    try {
      await requestApi((token) => api.updateStation(token, editingStationId, {
        machineName,
        ipAddress,
        isRegistered,
      }));
      setEditingStationId(null);
      await refresh();
    } catch (reason) {
      setStationActionError(reason instanceof Error ? reason.message : 'No se pudo actualizar la estación.');
    } finally {
      setSavingStation(false);
    }
  };

  return (
    <div className="page-content">
      <SectionHeading
        eyebrow="Inventario"
        title="Estaciones"
        description={isAdmin
          ? 'Consulta estaciones registradas y administra el nombre visible de sus equipos.'
          : 'Consulta las estaciones de trabajo registradas y sus dispositivos asignados.'}
      />
      <section className="content-card">
        <div className="content-card-heading">
          <div><h2>Estaciones registradas</h2><p>{loading ? 'Actualizando datos…' : `${stations.length} estaciones en total`}</p></div>
          <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>Actualizar</Button>
        </div>
        {editingStationId && (
          <form className="admin-form station-edit-form" onSubmit={(event) => void saveStation(event)}>
            <div className="admin-form-heading">
              <h3>Editar equipo de {stations.find((station) => station.id === editingStationId)?.name}</h3>
              <Button variant="ghost" type="button" onClick={() => setEditingStationId(null)}>Cancelar</Button>
            </div>
            {stationActionError && <Alert>{stationActionError}</Alert>}
            <label className="field">
              <span>Nombre visible del equipo</span>
              <input
                required
                maxLength={128}
                value={machineName}
                onChange={(event) => setMachineName(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Dirección IP (opcional)</span>
              <input
                maxLength={45}
                value={ipAddress}
                onChange={(event) => setIpAddress(event.target.value)}
              />
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={isRegistered}
                onChange={(event) => setIsRegistered(event.target.checked)}
              />
              <span>Estación registrada</span>
            </label>
            <div className="admin-form-actions">
              <Button type="submit" disabled={savingStation}>
                {savingStation ? 'Guardando…' : 'Guardar equipo'}
              </Button>
            </div>
          </form>
        )}
        {error ? <ErrorPanel message={error} onRetry={() => void refresh()} /> : loading ? (
          <LoadingState label="Cargando estaciones…" />
        ) : stations.length === 0 ? (
          <EmptyState title="No se encontraron estaciones" description="Las estaciones aparecerán aquí después de registrarse en el sistema." />
        ) : (
          <DataTable label="Estaciones registradas" columns={columns} rows={stations} />
        )}
      </section>
    </div>
  );
}

export function DevicesPage() {
  const { devices, loading, error, refresh } = useInventory();
  const { user, requestApi } = useAuth();
  const [diagnosticDevice, setDiagnosticDevice] = useState<Device | null>(null);
  const [diagnostics, setDiagnostics] = useState<DeviceDiagnosticRecord[]>([]);
  const [diagnosticLoadingId, setDiagnosticLoadingId] = useState<string | null>(null);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [maintenanceDevice, setMaintenanceDevice] = useState<Device | null>(null);
  const [operations, setOperations] = useState<MaintenanceRecord[]>([]);
  const [maintenanceLoadingId, setMaintenanceLoadingId] = useState<string | null>(null);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);

  const runDiagnostic = async (device: Device) => {
    setDiagnosticDevice(device);
    setDiagnosticLoadingId(device.id);
    setDiagnosticError(null);
    try {
      await requestApi((token) => api.runDiagnostic(token, device.id));
    } catch (reason) {
      setDiagnosticError(reason instanceof Error ? reason.message : 'No se pudo completar el diagnóstico.');
    } finally {
      try {
        const history = await requestApi((token) => api.diagnosticHistory(token, device.id));
        setDiagnostics(history);
      } catch (reason) {
        setDiagnosticError(reason instanceof Error ? reason.message : 'No se pudo consultar el historial.');
      }
      setDiagnosticLoadingId(null);
    }
  };

  const runMaintenance = async (device: Device, operation: MaintenanceOperation) => {
    const confirmation = `${operation} ${device.serialNumber}`;
    const entered = window.prompt(`Esta acción reiniciará el dispositivo. Para continuar, escribe:\n${confirmation}`);
    if (entered === null) return;

    setMaintenanceDevice(device);
    setMaintenanceLoadingId(device.id);
    setMaintenanceError(null);
    try {
      await requestApi((token) =>
        api.runMaintenanceOperation(token, device.id, operation, entered),
      );
    } catch (reason) {
      setMaintenanceError(reason instanceof Error ? reason.message : 'No se pudo confirmar la operación.');
    } finally {
      try {
        setOperations(await requestApi((token) => api.operationHistory(token, device.id)));
      } catch (reason) {
        setMaintenanceError(reason instanceof Error ? reason.message : 'No se pudo consultar el historial.');
      }
      setMaintenanceLoadingId(null);
    }
  };

  const columns: TableColumn<Device>[] = [
    { key: 'serial', title: 'Número de serie', render: (device) => <strong className="table-primary">{device.serialNumber}</strong> },
    { key: 'model', title: 'Modelo', render: (device) => device.model ?? 'No disponible' },
    { key: 'manufacturer', title: 'Fabricante', render: (device) => device.manufacturer ?? 'No disponible' },
    { key: 'build', title: 'Build', render: (device) => device.buildNumber ?? '—' },
    { key: 'state', title: 'Estado', render: (device) => <StatusBadge tone={deviceStateTone(device.state)}>{deviceStateLabel(device.state)}</StatusBadge> },
    { key: 'android', title: 'Android', render: (device) => device.androidVersion ?? '—' },
    { key: 'battery', title: 'Batería', render: (device) => device.batteryLevel == null ? '—' : `${device.batteryLevel}%` },
    { key: 'station', title: 'Estación', render: (device) => device.station?.name ?? 'Sin asignar' },
    {
      key: 'actions',
      title: 'Acciones autorizadas',
      render: (device) => (
        <div className="table-actions">
          <Button
            variant="secondary"
            disabled={device.state !== 'ANDROID_INIT' || diagnosticLoadingId !== null || maintenanceLoadingId !== null}
            onClick={() => void runDiagnostic(device)}
          >
            {diagnosticLoadingId === device.id ? 'Consultando…' : 'Diagnosticar'}
          </Button>
          <Button
            variant="ghost"
            disabled={device.state !== 'ANDROID_INIT' || maintenanceLoadingId !== null || diagnosticLoadingId !== null}
            onClick={() => void runMaintenance(device, 'REBOOT')}
          >
            {maintenanceLoadingId === device.id ? 'Reiniciando…' : 'Reiniciar'}
          </Button>
          {(user?.role === 'ADMIN' || user?.role === 'SUPERVISOR') && (
            <Button
              variant="ghost"
              disabled={device.state !== 'ANDROID_INIT' || maintenanceLoadingId !== null || diagnosticLoadingId !== null}
              onClick={() => void runMaintenance(device, 'REBOOT_RECOVERY')}
            >
              A recovery
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="page-content">
      <SectionHeading eyebrow="Inventario" title="Dispositivos" description="Información técnica reportada por las estaciones autenticadas." />
      <section className="content-card">
        <div className="content-card-heading">
          <div><h2>Dispositivos registrados</h2><p>{loading ? 'Actualizando datos…' : `${devices.length} dispositivos en total`}</p></div>
          <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>Actualizar</Button>
        </div>
        {error ? <ErrorPanel message={error} onRetry={() => void refresh()} /> : loading ? (
          <LoadingState label="Cargando dispositivos…" />
        ) : devices.length === 0 ? (
          <EmptyState title="No se encontraron dispositivos" description="Los dispositivos aparecerán aquí cuando una estación envíe su información." />
        ) : (
          <DataTable label="Dispositivos registrados" columns={columns} rows={devices} />
        )}
      </section>
      {diagnosticDevice && (
        <section className="content-card" aria-live="polite">
          <div className="content-card-heading">
            <div>
              <h2>Diagnóstico: {diagnosticDevice.serialNumber}</h2>
              <p>Lecturas disponibles a través de ADB. Los campos ausentes no se completan con valores estimados.</p>
            </div>
          </div>
          <div className="diagnostic-content">
            {diagnosticError && <Alert>{diagnosticError}</Alert>}
            {diagnosticLoadingId && <LoadingState label="Ejecutando consultas de solo lectura…" />}
            {!diagnosticLoadingId && diagnostics[0] && (
              <DiagnosticDetails record={diagnostics[0]} />
            )}
            {!diagnosticLoadingId && diagnostics.length > 1 && (
              <details>
                <summary>Historial anterior ({diagnostics.length - 1})</summary>
                <ul>
                  {diagnostics.slice(1).map((record) => (
                    <li key={record.id}>
                      {formatDateTime(record.createdAt)} · {diagnosticStatusLabel(record.status)} · {record.user.name}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </section>
      )}
      {maintenanceDevice && (
        <section className="content-card" aria-live="polite">
          <div className="content-card-heading">
            <div>
              <h2>Operaciones: {maintenanceDevice.serialNumber}</h2>
              <p>Solo reinicio normal y reinicio a recovery. No se ejecutan borrados ni flasheos.</p>
            </div>
          </div>
          <div className="diagnostic-content">
            {maintenanceError && <Alert>{maintenanceError}</Alert>}
            {maintenanceLoadingId && <LoadingState label="Esperando confirmación del agente…" />}
            {!maintenanceLoadingId && operations.length === 0 && (
              <EmptyState title="Sin operaciones registradas" description="El historial aparecerá después de confirmar una acción." />
            )}
            {!maintenanceLoadingId && operations.length > 0 && (
              <ul>
                {operations.map((operation) => (
                  <li key={operation.id}>
                    {formatDateTime(operation.createdAt)} · {maintenanceOperationLabel(operation.type)} · {maintenanceStatusLabel(operation.status)} · {operation.user.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function DiagnosticDetails({ record }: { record: DeviceDiagnosticRecord }) {
  const result = record.result;
  return (
    <div>
      <p>
        <StatusBadge tone={record.status === 'SUCCESS' ? 'success' : record.status === 'FAILED' ? 'warning' : 'neutral'}>
          {diagnosticStatusLabel(record.status)}
        </StatusBadge>
        {' · '}{formatDateTime(record.createdAt)} · Técnico: {record.user.name}
      </p>
      {result && (
        <dl className="diagnostic-results">
          <div><dt>Modelo</dt><dd>{result.properties.model ?? 'No disponible'}</dd></div>
          <div><dt>Android</dt><dd>{result.properties.androidVersion ?? 'No disponible'}</dd></div>
          <div><dt>Batería</dt><dd>{result.battery.level === undefined ? 'No disponible' : `${result.battery.level}%`}</dd></div>
          <div><dt>Temperatura batería</dt><dd>{result.battery.temperatureCelsius === undefined ? 'No disponible' : `${result.battery.temperatureCelsius} °C`}</dd></div>
          <div><dt>Almacenamiento libre</dt><dd>{formatBytes(result.storage.availableBytes)}</dd></div>
          <div><dt>Memoria disponible</dt><dd>{formatBytes(result.memory.availableBytes)}</dd></div>
          <div><dt>Depuración USB</dt><dd>{result.usbDebugging === null ? 'No disponible' : result.usbDebugging ? 'Activada' : 'Desactivada'}</dd></div>
          <div><dt>Interfaces de red</dt><dd>{result.connectivity.interfaces.map((item) => item.name).join(', ') || 'No disponible'}</dd></div>
        </dl>
      )}
      {record.errors.length > 0 && (
        <div>
          <h3>Datos no disponibles o errores</h3>
          <ul>{record.errors.map((error) => <li key={error}>{error}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return 'No disponible';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function diagnosticStatusLabel(status: DeviceDiagnosticRecord['status']): string {
  switch (status) {
    case 'SUCCESS': return 'Completo';
    case 'PARTIAL': return 'Parcial';
    case 'FAILED': return 'Fallido';
    case 'PENDING': return 'Pendiente';
  }
}

function maintenanceOperationLabel(operation: string): string {
  if (operation === 'REBOOT') return 'Reinicio normal';
  if (operation === 'REBOOT_RECOVERY') return 'Reinicio a recovery';
  return operation;
}

function maintenanceStatusLabel(status: string): string {
  if (status === 'SUCCESS') return 'Comando aceptado por agente; reinicio físico sin verificar';
  if (status === 'FAILED') return 'No ejecutado';
  if (status === 'UNKNOWN') return 'Sin confirmación; inspeccionar antes de reintentar';
  if (status === 'PENDING') return 'Pendiente';
  return status;
}

export function AdminUsersPage() {
  const { users, loading, error, refresh } = useUsers();
  const { user: currentUser, requestApi } = useAuth();
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: '',
    name: '',
    password: '',
    role: defaultUserRole,
    isActive: true,
  });

  const startCreate = () => {
    setEditingId(null);
    setForm({ email: '', name: '', password: '', role: defaultUserRole, isActive: true });
    setActionError(null);
    setFormOpen(true);
  };

  const startEdit = (user: UserListItem) => {
    setEditingId(user.id);
    setForm({
      email: user.email,
      name: user.name,
      password: '',
      role: user.role,
      isActive: user.isActive,
    });
    setActionError(null);
    setFormOpen(true);
  };

  const saveUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setActionError(null);
    try {
      if (editingId) {
        await requestApi((token) => api.updateUser(token, editingId, {
          email: form.email,
          name: form.name,
          role: form.role,
          isActive: form.isActive,
          ...(form.password ? { password: form.password } : {}),
        }));
      } else {
        await requestApi((token) => api.createUser(token, {
          email: form.email,
          name: form.name,
          password: form.password,
          role: form.role,
        }));
      }
      setFormOpen(false);
      await refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'No se pudo guardar el usuario.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (account: UserListItem) => {
    const nextActive = !account.isActive;
    if (!nextActive && !window.confirm(`¿Desactivar la cuenta de ${account.name}?`)) return;
    setActionError(null);
    try {
      await requestApi((token) => api.updateUser(token, account.id, { isActive: nextActive }));
      await refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'No se pudo actualizar el estado.');
    }
  };

  const columns: TableColumn<UserListItem>[] = [
    { key: 'name', title: 'Nombre', render: (user) => <strong className="table-primary">{user.name}</strong> },
    { key: 'email', title: 'Correo electrónico', render: (user) => user.email },
    { key: 'role', title: 'Rol', render: (user) => roleTitle(user.role) },
    {
      key: 'active',
      title: 'Estado',
      render: (user) => <StatusBadge tone={user.isActive ? 'success' : 'neutral'}>{user.isActive ? 'Activo' : 'Inactivo'}</StatusBadge>,
    },
    { key: 'created', title: 'Fecha de alta', render: (user) => formatDate(user.createdAt) },
    {
      key: 'actions',
      title: 'Acciones',
      render: (account) => (
        <div className="table-actions">
          <Button variant="ghost" onClick={() => startEdit(account)}>Editar</Button>
          <Button
            variant="ghost"
            disabled={account.id === currentUser?.id}
            onClick={() => void toggleActive(account)}
          >
            {account.isActive ? 'Desactivar' : 'Activar'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="page-content">
      <SectionHeading
        eyebrow="Administración"
        title="Usuarios"
        description="Crea cuentas, asigna roles y controla el acceso de usuarios."
      />
      {actionError && !formOpen && <div className="admin-action-error"><Alert>{actionError}</Alert></div>}
      <section className="content-card">
        <div className="content-card-heading">
          <div><h2>Directorio de usuarios</h2><p>{loading ? 'Actualizando datos…' : `${users.length} cuentas`}</p></div>
          <div className="section-actions">
            <Button variant="primary" onClick={startCreate}>Crear usuario</Button>
            <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>Actualizar</Button>
          </div>
        </div>
        {formOpen && (
          <form className="admin-form" onSubmit={(event) => void saveUser(event)}>
            <div className="admin-form-heading">
              <h3>{editingId ? 'Editar usuario' : 'Crear usuario'}</h3>
              <Button variant="ghost" type="button" onClick={() => setFormOpen(false)}>Cancelar</Button>
            </div>
            {actionError && <Alert>{actionError}</Alert>}
            <div className="admin-form-grid">
              <label className="field">
                <span>Nombre</span>
                <input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </label>
              <label className="field">
                <span>Correo electrónico</span>
                <input required type="email" maxLength={254} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
              </label>
              <label className="field">
                <span>{editingId ? 'Nueva contraseña (opcional)' : 'Contraseña temporal'}</span>
                <input
                  required={!editingId}
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Rol</span>
                <select
                  disabled={editingId === currentUser?.id}
                  value={form.role}
                  onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })}
                >
                  <option value="ADMIN">Administrador</option>
                  <option value="SUPERVISOR">Supervisor</option>
                  <option value="TECHNICIAN">Técnico</option>
                </select>
              </label>
              {editingId && (
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    disabled={editingId === currentUser?.id}
                    checked={form.isActive}
                    onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
                  />
                  <span>Cuenta activa</span>
                </label>
              )}
            </div>
            <div className="admin-form-actions">
              <Button type="submit" disabled={saving}>
                {saving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Crear usuario'}
              </Button>
            </div>
          </form>
        )}
        {error ? <ErrorPanel message={error} onRetry={() => void refresh()} /> : loading ? (
          <LoadingState label="Cargando usuarios…" />
        ) : users.length === 0 ? (
          <EmptyState title="No hay usuarios registrados" description="Crea una cuenta para permitir el acceso a la plataforma." />
        ) : (
          <DataTable label="Directorio de usuarios" columns={columns} rows={users} />
        )}
      </section>
    </div>
  );
}

export function AdminSessionsPage() {
  const { sessions, loading, error, refresh } = useAdminSessions();
  const { requestApi } = useAuth();
  const [actionError, setActionError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const revoke = async (session: AdminSession) => {
    if (!window.confirm(`¿Revocar la sesión de ${session.user.name}?`)) return;
    setRevokingId(session.id);
    setActionError(null);
    try {
      await requestApi((token) => api.revokeSession(token, session.id));
      await refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'No se pudo revocar la sesión.');
    } finally {
      setRevokingId(null);
    }
  };

  const columns: TableColumn<AdminSession>[] = [
    { key: 'user', title: 'Usuario', render: (session) => <strong className="table-primary">{session.user.name}</strong> },
    { key: 'email', title: 'Correo', render: (session) => session.user.email },
    { key: 'role', title: 'Rol', render: (session) => roleTitle(session.user.role) },
    { key: 'created', title: 'Creada', render: (session) => formatDateTime(session.createdAt) },
    { key: 'expires', title: 'Expira', render: (session) => formatDateTime(session.expiresAt) },
    {
      key: 'status',
      title: 'Estado',
      render: (session) => <StatusBadge tone={isSessionActive(session) ? 'success' : 'neutral'}>
        {isSessionActive(session) ? 'Activa' : 'Inactiva'}
      </StatusBadge>,
    },
    {
      key: 'actions',
      title: 'Acciones',
      render: (session) => !isSessionActive(session) ? '—' : (
        <Button
          variant="ghost"
          disabled={revokingId === session.id}
          onClick={() => void revoke(session)}
        >
          {revokingId === session.id ? 'Revocando…' : 'Revocar'}
        </Button>
      ),
    },
  ];

  return (
    <div className="page-content">
      <SectionHeading eyebrow="Administración" title="Sesiones" description="Consulta y revoca sesiones de usuario activas." actions={<Button variant="secondary" onClick={() => void refresh()} disabled={loading}>Actualizar</Button>} />
      {actionError && <div className="admin-action-error"><Alert>{actionError}</Alert></div>}
      <section className="content-card">
        <div className="content-card-heading"><div><h2>Sesiones recientes</h2><p>Se muestran hasta 100 sesiones, sin exponer tokens.</p></div></div>
        {error ? <ErrorPanel message={error} onRetry={() => void refresh()} /> : loading ? (
          <LoadingState label="Cargando sesiones…" />
        ) : sessions.length === 0 ? (
          <EmptyState title="No hay sesiones" description="Las sesiones aparecerán después de los inicios de sesión." />
        ) : (
          <DataTable label="Sesiones de usuarios" columns={columns} rows={sessions} />
        )}
      </section>
    </div>
  );
}

export function AdminAuditPage() {
  const { entries, loading, error, refresh } = useAuditEntries();
  const columns: TableColumn<AuditEntry>[] = [
    { key: 'date', title: 'Fecha', render: (entry) => formatDateTime(entry.createdAt) },
    { key: 'action', title: 'Acción', render: (entry) => <strong className="table-primary">{auditActionLabel(entry.action)}</strong> },
    { key: 'actor', title: 'Usuario', render: (entry) => `${entry.user.name} (${roleTitle(entry.user.role)})` },
    { key: 'target', title: 'Objetivo', render: (entry) => entry.target },
    { key: 'details', title: 'Detalles', render: (entry) => entry.details ? summarizeAuditDetails(entry.details) : '—' },
  ];

  return (
    <div className="page-content">
      <SectionHeading eyebrow="Administración" title="Auditoría" description="Trazabilidad de accesos y cambios administrativos registrados por el sistema." actions={<Button variant="secondary" onClick={() => void refresh()} disabled={loading}>Actualizar</Button>} />
      <section className="content-card">
        <div className="content-card-heading"><div><h2>Eventos recientes</h2><p>Se muestran hasta 100 eventos recientes.</p></div></div>
        {error ? <ErrorPanel message={error} onRetry={() => void refresh()} /> : loading ? (
          <LoadingState label="Cargando auditoría…" />
        ) : entries.length === 0 ? (
          <EmptyState title="Aún no hay eventos" description="Los inicios y cierres de sesión, así como los cambios administrativos, se registrarán aquí." />
        ) : (
          <DataTable label="Registro de auditoría" columns={columns} rows={entries} />
        )}
      </section>
    </div>
  );
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(parsed);
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function isSessionActive(session: AdminSession): boolean {
  return (
    !session.revokedAt &&
    session.user.isActive &&
    new Date(session.expiresAt).getTime() > Date.now()
  );
}

function auditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    AUTH_LOGIN: 'Inicio de sesión',
    AUTH_LOGOUT: 'Cierre de sesión',
    USER_CREATED: 'Usuario creado',
    USER_UPDATED: 'Usuario actualizado',
    INITIAL_ADMIN_CREATED: 'Administrador inicial creado',
    ADMIN_REVOKED_SESSION: 'Sesión revocada por administrador',
    STATION_UPDATED: 'Estación actualizada',
  };
  return labels[action] ?? action;
}

function summarizeAuditDetails(details: string): string {
  try {
    const parsed: unknown = JSON.parse(details);
    if (typeof parsed !== 'object' || parsed === null) return details;
    const record = parsed as Record<string, unknown>;
    const fields = Array.isArray(record.fields) ? record.fields.join(', ') : undefined;
    const passwordChanged = record.passwordChanged === true;
    const role = typeof record.role === 'string' ? `Rol: ${roleTitle(record.role as UserRole)}` : undefined;
    return [fields ? `Campos: ${fields}` : undefined, role, passwordChanged ? 'Contraseña actualizada' : undefined]
      .filter(Boolean)
      .join(' · ') || 'Cambio registrado';
  } catch {
    return 'Cambio registrado';
  }
}

function roleTitle(role?: UserRole): string {
  switch (role) {
    case 'ADMIN':
      return 'Administrador';
    case 'SUPERVISOR':
      return 'Supervisor';
    case 'TECHNICIAN':
      return 'Técnico';
    default:
      return 'Usuario';
  }
}

function deviceStateLabel(state: string): string {
  const labels: Record<string, string> = {
    ANDROID_INIT: 'Android',
    RECOVERY: 'Recovery',
    DOWNLOAD_MODE: 'Download mode',
    UNKNOWN_INTERFACE: 'Interfaz desconocida',
    UNKNOWN: 'Desconocido',
    OFF: 'Desconectado',
    INCOMPATIBLE: 'Incompatible',
  };
  return labels[state] ?? state;
}

function deviceStateTone(state: string): 'success' | 'warning' | 'error' | 'neutral' | 'info' {
  if (state === 'ANDROID_INIT') return 'success';
  if (state === 'RECOVERY' || state === 'DOWNLOAD_MODE') return 'info';
  if (state === 'OFF' || state === 'UNKNOWN_INTERFACE') return 'warning';
  if (state === 'INCOMPATIBLE') return 'error';
  return 'neutral';
}
