import { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button className={`button button-${variant} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function FormField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="alert-indicator" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function LoadingState({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">—</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  caption,
  accent = 'blue',
}: {
  label: string;
  value: string | number;
  caption: string;
  accent?: 'blue' | 'teal';
}) {
  return (
    <article className={`metric-card metric-${accent}`}>
      <div className="metric-card-top">
        <span className="metric-icon" aria-hidden="true">{accent === 'blue' ? 'ST' : 'DV'}</span>
        <span className="metric-caption">{caption}</span>
      </div>
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'success' | 'warning' | 'error' | 'neutral' | 'info';
}) {
  return <span className={`status-badge status-${tone}`}>{children}</span>;
}

export interface TableColumn<T> {
  key: string;
  title: string;
  render: (row: T) => ReactNode;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  label,
}: {
  columns: TableColumn<T>[];
  rows: T[];
  label: string;
}) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="data-table">
        <thead>
          <tr>{columns.map((column) => <th key={column.key} scope="col">{column.title}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => <td key={column.key}>{column.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="section-description">{description}</p>
      </div>
      {actions && <div className="section-actions">{actions}</div>}
    </div>
  );
}
