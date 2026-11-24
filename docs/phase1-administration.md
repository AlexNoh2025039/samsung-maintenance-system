# Administración de la plataforma

## Capacidades disponibles

- Los usuarios pueden iniciar y cerrar sesión con tokens opacos; la API guarda únicamente el hash del token.
- ADMIN puede crear usuarios, actualizar su nombre/correo/rol, cambiar contraseña y activar o desactivar cuentas.
- La API impide que un administrador cambie su propio rol o desactive su cuenta, y conserva al menos un ADMIN activo.
- ADMIN puede consultar las 100 sesiones más recientes y revocarlas. Las respuestas nunca incluyen tokens ni sus hashes.
- ADMIN puede consultar los 100 eventos recientes de auditoría.
- ADMIN puede consultar métricas agregadas reales en `GET /api/admin/dashboard`.
- ADMIN puede cambiar el nombre visible del equipo, dirección IP registrada y estado administrativo de una estación. El nombre de estación usado para autenticar al agente no se modifica.
- Se registran inicios/cierres de sesión, creación del administrador inicial, altas/cambios de usuarios y revocaciones administrativas de sesión. Los detalles de auditoría no contienen contraseñas.
- ADMIN, SUPERVISOR y TECHNICIAN pueden consultar el inventario; la administración de usuarios, sesiones y auditoría está restringida en el backend a ADMIN.
- Las estaciones se crean al registrarse el agente autenticado. La autorización del agente continúa dependiendo de `STATION_TOKENS`; no se exponen tokens de estación a la interfaz. No se puede crear ni borrar una estación desde la interfaz.

## Endpoints administrativos

- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `GET /api/admin/sessions`
- `DELETE /api/admin/sessions/:id`
- `GET /api/admin/audit`
- `GET /api/admin/dashboard`
- `PATCH /api/admin/stations/:id`

Todos requieren una sesión de usuario válida y rol `ADMIN`. `GET /health` permanece público. La autenticación Socket.IO del agente es independiente.

No se requiere una migración nueva para estas capacidades: se utilizan los modelos existentes `User`, `AuthSession` y `AuditLog`.

## Límites de esta fase

Las estaciones se registran desde el agente; desde la interfaz se pueden editar metadatos pero no crear/borrar estaciones ni cambiar su identidad de autenticación. La Fase 1 no implementa operaciones ADB; los reinicios autorizados se documentan en la guía de instalación y uso.
