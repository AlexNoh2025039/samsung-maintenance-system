import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { UserRole } from '@samsung-maintenance/shared';
import { useAuth } from './auth-context';
import { Alert, Button, FormField, LoadingState } from './ui';

export function ProtectedRoute({ children }: { children?: ReactNode }) {
  const { status, error, retrySession } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return <main className="state-screen"><LoadingState label="Validando sesión…" /></main>;
  }
  if (status === 'error') {
    return (
      <main className="state-screen">
        <Alert>{error}</Alert>
        <Button variant="secondary" onClick={retrySession}>Reintentar</Button>
      </main>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children ? <>{children}</> : <Outlet />;
}

export function RoleRoute({ roles, children }: { roles: readonly string[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function LoginPage() {
  const { status, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const logoutError = (location.state as { logoutError?: string } | null)?.logoutError;

  if (status === 'authenticated') return <Navigate to="/" replace />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from?.startsWith('/') ? from : '/', { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo iniciar sesión.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <div className="login-brand-panel" aria-hidden="true">
        <div className="login-brand-lockup">
          <span className="brand-symbol">SM</span>
          <span>Samsung<br /><strong>Maintenance System</strong></span>
        </div>
        <div className="login-brand-copy">
          <span className="brand-kicker">Plataforma de servicio técnico</span>
          <h2>Diagnóstico y mantenimiento, en un solo lugar.</h2>
          <p>Gestión centralizada de estaciones y dispositivos conectados.</p>
        </div>
        <span className="brand-panel-footer">Entorno seguro de trabajo</span>
      </div>
      <section className="login-content">
        <div className="login-card">
          <div className="login-mobile-brand">
            <span className="brand-symbol">SM</span>
            <span>Samsung Maintenance</span>
          </div>
          <p className="eyebrow">Acceso al sistema</p>
          <h1>Bienvenido</h1>
          <p className="muted">Inicia sesión con tu cuenta de organización.</p>
          {logoutError && <Alert>{logoutError}</Alert>}
          <form onSubmit={submit}>
            <FormField id="email" label="Correo electrónico">
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-describedby={error ? 'login-error' : undefined}
              />
            </FormField>
            <FormField id="password" label="Contraseña">
              <div className="password-field">
                <input
                  id="password"
                  type={passwordVisible ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-describedby={error ? 'login-error' : undefined}
                />
                <button
                  className="password-toggle"
                  type="button"
                  aria-label={passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={passwordVisible}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                >
                  {passwordVisible ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            </FormField>
            {error && <p className="form-error" id="login-error" role="alert">{error}</p>}
            <Button className="button-full login-submit" disabled={submitting}>
              {submitting ? <><span className="spinner spinner-light" aria-hidden="true" /> Validando…</> : 'Iniciar sesión'}
            </Button>
          </form>
          <p className="login-security-note"><span aria-hidden="true">●</span> Acceso protegido por la organización</p>
        </div>
        <footer className="login-footer">Samsung Maintenance System <span>·</span> Uso interno autorizado</footer>
      </section>
    </main>
  );
}

const sections = {
  dashboard: { title: 'Panel', path: '/' },
  stations: { title: 'Estaciones', path: '/stations' },
  devices: { title: 'Dispositivos', path: '/devices' },
  users: { title: 'Usuarios', path: '/admin/users' },
  sessions: { title: 'Sesiones', path: '/admin/sessions' },
  audit: { title: 'Auditoría', path: '/admin/audit' },
};

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link className="sidebar-brand" to="/" aria-label="Samsung Maintenance System, ir al panel" onClick={onNavigate}>
      <span className="brand-symbol">SM</span>
      <span className="brand-name">Samsung <strong>Maintenance</strong><small>DEVICE SERVICE PLATFORM</small></span>
    </Link>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `nav-link${isActive ? ' nav-link-active' : ''}`;

  return (
    <nav className="sidebar-nav" aria-label="Navegación principal">
      <span className="nav-section-label">ESPACIO DE TRABAJO</span>
      <NavLink to={sections.dashboard.path} end className={navClass} onClick={onNavigate}>
        <NavIcon glyph="▦" /><span>Panel</span>
      </NavLink>
      <span className="nav-section-label nav-section-spaced">INVENTARIO</span>
      <NavLink to={sections.stations.path} className={navClass} onClick={onNavigate}>
        <NavIcon glyph="▤" /><span>Estaciones</span>
      </NavLink>
      <NavLink to={sections.devices.path} className={navClass} onClick={onNavigate}>
        <NavIcon glyph="▣" /><span>Dispositivos</span>
      </NavLink>
      {user?.role === 'ADMIN' && (
        <>
          <span className="nav-section-label nav-section-spaced">ADMINISTRACIÓN</span>
          <NavLink to={sections.users.path} className={navClass} onClick={onNavigate}>
            <NavIcon glyph="♙" /><span>Usuarios</span>
          </NavLink>
          <NavLink to={sections.sessions.path} className={navClass} onClick={onNavigate}>
            <NavIcon glyph="◷" /><span>Sesiones</span>
          </NavLink>
          <NavLink to={sections.audit.path} className={navClass} onClick={onNavigate}>
            <NavIcon glyph="≋" /><span>Auditoría</span>
          </NavLink>
        </>
      )}
    </nav>
  );
}

function NavIcon({ glyph }: { glyph: string }) {
  return <span className="nav-icon" aria-hidden="true">{glyph}</span>;
}

function sectionTitle(pathname: string): string {
  if (pathname.startsWith('/admin/users')) return sections.users.title;
  if (pathname.startsWith('/admin/sessions')) return sections.sessions.title;
  if (pathname.startsWith('/admin/audit')) return sections.audit.title;
  if (pathname.startsWith('/stations')) return sections.stations.title;
  if (pathname.startsWith('/devices')) return sections.devices.title;
  return sections.dashboard.title;
}

export function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileNavigationRef = useRef<HTMLDivElement>(null);
  const mobileMenuToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    mobileNavigationRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        mobileMenuToggleRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileMenuOpen]);

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
    mobileMenuToggleRef.current?.focus();
  };

  const logout = async () => {
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (reason) {
      const message = reason instanceof Error
        ? `Se cerró la sesión localmente, pero el servidor no confirmó la revocación: ${reason.message}`
        : 'Se cerró la sesión localmente, pero el servidor no confirmó la revocación.';
      navigate('/login', { replace: true, state: { logoutError: message } });
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <Navigation />
        <div className="sidebar-bottom">
          <div className="sidebar-help"><span className="help-mark">i</span><span>¿Necesitas ayuda?<small>Contacta a tu administrador</small></span></div>
          <div className="sidebar-version">SAMSUNG MAINTENANCE <span>v1.0</span></div>
        </div>
      </aside>
      {mobileMenuOpen && (
        <button className="mobile-backdrop" aria-label="Cerrar menú" onClick={() => setMobileMenuOpen(false)} />
      )}
      <div className="app-main">
        <header className="topbar">
          <button
            ref={mobileMenuToggleRef}
            className="mobile-menu-toggle"
            aria-label={mobileMenuOpen ? 'Cerrar navegación' : 'Abrir navegación'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <span /><span /><span />
          </button>
          <div className="topbar-title">
            <span>Samsung Maintenance</span>
            <strong>{sectionTitle(location.pathname)}</strong>
          </div>
          <div className="topbar-account">
            <span className="user-avatar" aria-hidden="true">{user?.name.slice(0, 1).toUpperCase()}</span>
            <div className="account-copy">
              <strong>{user?.name}</strong>
              <span>{roleLabel(user?.role)}</span>
            </div>
            <Button variant="secondary" className="logout-button" onClick={logout}>Cerrar sesión</Button>
          </div>
        </header>
        <div
          ref={mobileNavigationRef}
          id="mobile-navigation"
          className={`mobile-navigation${mobileMenuOpen ? ' mobile-navigation-open' : ''}`}
          aria-hidden={!mobileMenuOpen}
        >
          <Brand onNavigate={closeMobileMenu} />
          <Navigation onNavigate={closeMobileMenu} />
        </div>
        <main className="main-content"><Outlet /></main>
      </div>
    </div>
  );
}

function roleLabel(role?: UserRole): string {
  switch (role) {
    case 'ADMIN':
      return 'Administrador';
    case 'SUPERVISOR':
      return 'Supervisor';
    case 'TECHNICIAN':
      return 'Técnico';
    default:
      return '';
  }
}
