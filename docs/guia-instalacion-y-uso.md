# Guía de instalación y uso

Guía práctica para levantar el sistema en Windows, crear el primer usuario, conectar una estación y probarlo de forma segura. Para Linux/macOS, los mismos scripts pnpm sirven; adapta las instrucciones de copia de archivos y servicios.

## 1. Qué hace hoy

| Módulo | Estado |
| --- | --- |
| Acceso, usuarios y roles | Implementado; las rutas administrativas requieren rol ADMIN. |
| Estaciones e inventario | Implementado; el agente autentica la estación y sincroniza dispositivos. |
| Agente ADB | Implementado; detecta conexión y autorización ADB y lee propiedades básicas. |
| Diagnóstico | Implementado con consultas ADB de solo lectura, resultado parcial cuando Android limita datos e historial persistido por técnico/dispositivo. |
| Operaciones de mantenimiento | Reinicio normal disponible para usuarios autorizados; reinicio a recovery solo ADMIN/SUPERVISOR. Ambos exigen escribir el número de serie y quedan registrados. Restablecimiento de fábrica aún no está disponible. |
| Firmware y perfiles de aplicaciones | Pendiente. No hay URLs, paquetes ni fuentes simuladas. |
| Validación física | Pendiente hasta tener un Samsung real autorizado por su propietario. |

Las pruebas con comandos simulados verifican validación, transporte, persistencia lógica y manejo de errores; **no equivalen a certificar compatibilidad física**. La base PostgreSQL de producción debe recibir las migraciones y validarse en el entorno de despliegue.

## 2. Requisitos

- Windows 10/11 de 64 bits.
- Node.js `>=20.12.0`.
- pnpm.
- PostgreSQL accesible para la API.
- Android SDK Platform-Tools (`adb`) instalado en cada PC que opere como estación. Instálalo desde la distribución oficial de Android y confirma `adb version` en PowerShell.
- Para pruebas físicas: dispositivo Samsung, cable de datos funcional y autorización del propietario para activar depuración USB.

En PowerShell, comprueba los prerequisitos:

```powershell
node --version
pnpm --version
psql --version
adb version
```

Si pnpm no está instalado pero Node sí, habilita Corepack y activa pnpm con la versión que usa tu organización:

```powershell
corepack enable
corepack prepare pnpm@latest --activate
```

## 3. Instalar el proyecto

Abre PowerShell en la raíz del repositorio:

```powershell
pnpm install
pnpm -r build
```

No uses `npm install`. El proyecto se administra con pnpm.

## 4. Configurar PostgreSQL y API

1. Crea una base y un usuario de PostgreSQL para la aplicación.
2. Copia la plantilla:

```powershell
Copy-Item apps\api\.env.example apps\api\.env
```

3. Edita `apps\api\.env` y configura al menos:

```dotenv
DATABASE_URL=postgresql://USUARIO:CONTRASENA@localhost:5432/samsung_maintenance?schema=public
API_HOST=127.0.0.1
STATION_TOKENS={"WORKSTATION":"SUSTITUIR_POR_TOKEN_ALEATORIO_DE_32_CARACTERES_O_MAS"}
CORS_ORIGINS=http://localhost:5173
AUTH_SESSION_TTL_HOURS=8
INITIAL_ADMIN_EMAIL=admin@tu-organizacion.example
INITIAL_ADMIN_NAME=Administrador inicial
INITIAL_ADMIN_PASSWORD=soladsolad1234
```

Usa una contraseña de PostgreSQL y tokens generados para tu entorno; no copies literalmente los valores de ejemplo ni compartas el archivo `.env`. Cada estación debe tener un token distinto y de al menos 32 caracteres. El valor de `STATION_TOKENS` debe ser JSON válido en una sola línea.

4. Aplica las migraciones con Prisma:

```powershell
pnpm --filter @samsung-maintenance/api exec prisma migrate deploy
pnpm --filter @samsung-maintenance/api exec prisma generate
```

En una base vacía, `migrate deploy` crea el esquema a partir de las migraciones del repositorio. En una base que ya contenga tablas, no uses `db push` ni borres datos: haz una copia de seguridad y revisa `prisma migrate status` con quien administre PostgreSQL antes de reconciliar el historial de migraciones.

5. Crea el primer administrador una sola vez:

```powershell
pnpm --filter @samsung-maintenance/api create-admin
```

El comando falla de forma intencional si ya existe un usuario. Después de crear la cuenta, borra `INITIAL_ADMIN_PASSWORD` y las demás credenciales temporales de `apps\api\.env`; nunca las agregues a Git.

## 5. Configurar el agente de la estación

En la PC con el cable USB y ADB:

```powershell
Copy-Item apps\agent\.env.example apps\agent\.env
```

Configura `apps\agent\.env` para que coincidan el nombre y token con el objeto `STATION_TOKENS` de la API:

```dotenv
SERVER_URL=http://localhost:4000
STATION_NAME=WORKSTATION
STATION_TOKEN=EL_MISMO_TOKEN_ALEATORIO_CONFIGURADO_EN_LA_API
```

Comprueba que `adb version` funcione desde la misma cuenta Windows que ejecutará el agente. Mantén `.env` accesible solo a los técnicos autorizados.

### Estación en otra computadora

La API escucha en `127.0.0.1` por defecto. Para que un agente de otra PC acceda:

1. Configura `API_HOST=0.0.0.0` en la API y reiníciala.
2. En `SERVER_URL`, usa la dirección privada de la PC/API, por ejemplo `http://192.168.x.y:4000`.
3. Permite el puerto solo en la red privada y limita el acceso con el firewall.
4. Configura `CORS_ORIGINS` con el origen real de la interfaz web.
5. Para uso fuera de una sola PC, publica API y Socket.IO detrás de HTTPS/WSS con un proxy TLS. No expongas el puerto de API a Internet: los tokens de estación son credenciales.

## 6. Iniciar el sistema

Abre tres terminales PowerShell en la raíz del repositorio.

**Terminal 1 — API:**

```powershell
pnpm --filter @samsung-maintenance/api dev
```

**Terminal 2 — interfaz web:**

```powershell
pnpm --filter @samsung-maintenance/web dev
```

**Terminal 3 — agente de estación:**

```powershell
pnpm --filter @samsung-maintenance/agent dev
```

Abre la URL que Vite indique, normalmente `http://127.0.0.1:5173`, e inicia sesión con la cuenta ADMIN recién creada. El agente debe informar que autenticó la estación. `GET http://127.0.0.1:4000/health` confirma que el proceso API responde; para verificar base de datos, revisa también el inventario o los logs de API.

Detén cada proceso con `Ctrl+C`. El agente cierra el socket y deja de escanear al recibir la señal.

## 7. Uso habitual

### Administrador

1. Inicia sesión como ADMIN.
2. En **Usuarios**, crea cuentas con nombre, correo, contraseña inicial de 12 o más caracteres y rol apropiado.
3. Asigna ADMIN solo a quien administre el sistema; SUPERVISOR y TECHNICIAN trabajan con inventario.
4. En **Estaciones**, revisa el nombre registrado y edita los metadatos visibles. No cambies el nombre autenticado sin actualizar de forma coordinada la configuración de tokens del agente.
5. En **Sesiones** revisa y revoca accesos cuando corresponda.
6. En **Auditoría** revisa eventos de acceso y cambios administrativos.

### Técnico

1. Inicia sesión con una cuenta autorizada.
2. Revisa **Dispositivos** y confirma la estación, número de serie y estado.
3. Usa **Diagnosticar** solo para dispositivos en estado conectado y autorizado (`ANDROID_INIT`).
4. Revisa los resultados y errores parciales. Un campo “No disponible” significa que ADB/Android no entregó un valor verificable; no es una estimación.
5. El historial del panel de diagnóstico muestra fecha, técnico, estado y resultados recientes.
6. **Reiniciar** y **A recovery** ejecutan una acción real: revisa el número de serie y escribe exactamente `REBOOT <SERIAL>` o `REBOOT_RECOVERY <SERIAL>` en la confirmación. Recovery está limitado a ADMIN/SUPERVISOR. `SUCCESS` solo confirma que el agente aceptó el comando ADB; verifica físicamente que el reinicio ocurrió. Si el resultado queda `UNKNOWN`, no repitas el comando a ciegas: revisa el teléfono y el agente primero.

Los diagnósticos consultan propiedades, batería, almacenamiento `/data`, memoria, interfaces/rutas de red y estado de depuración cuando Android los permite. Son lecturas; no flashean, borran ni cambian la configuración del teléfono.

### Acciones disponibles por API

Todas estas rutas requieren token de usuario e inventario autorizado (ADMIN, SUPERVISOR o TECHNICIAN):

| Ruta | Uso |
| --- | --- |
| `GET /api/devices` | Inventario conectado/reportado por las estaciones. |
| `POST /api/devices/:id/diagnostics` | Ejecuta y persiste un diagnóstico de solo lectura. |
| `GET /api/devices/:id/diagnostics` | Devuelve hasta 50 diagnósticos recientes con resultado, errores y técnico. |
| `POST /api/devices/:id/operations` | Ejecuta reinicio confirmado; recovery requiere ADMIN/SUPERVISOR. |
| `GET /api/devices/:id/operations` | Devuelve hasta 50 operaciones recientes y su operador. |

El API envía la solicitud únicamente al agente autenticado de la estación asignada. Si no está conectado, registra el fallo. Si se pierde el ACK después de solicitar un reinicio, registra `UNKNOWN`: no significa que el dispositivo no haya reiniciado. Verifica el estado físico antes de volver a intentar.

## 8. Primera prueba física cuando haya un Samsung disponible

Realiza esta comprobación con el propietario/técnico autorizado y un dispositivo de prueba que no contenga datos críticos:

1. Confirma la instalación de Platform-Tools con `adb version`.
2. Conecta el teléfono con un cable que transmita datos.
3. En el teléfono, el propietario activa Opciones de desarrollador/Depuración USB y acepta el diálogo de autorización para esa PC. No intentes saltar una pantalla de bloqueo ni obtener autorización sin consentimiento.
4. En PowerShell ejecuta `adb devices`. El número de serie debe aparecer con estado `device`, no `unauthorized` ni `offline`.
5. Confirma que el agente reporta la estación autenticada y que el equipo aparece en **Dispositivos**. La primera lectura puede tardar varios segundos.
6. Ejecuta **Diagnosticar**. Compara los valores mostrados con lecturas disponibles en el dispositivo y anota diferencias, campos ausentes y logs de API/agente.
7. Desconecta el cable: la estación debe reflejar desconexión después del siguiente escaneo. Reconecta y vuelve a autorizar si Android lo solicita.
8. Solo en un dispositivo de prueba y después de acordar el momento con su responsable, prueba reinicio normal y, luego, reinicio a recovery por separado. Confirma la transición física y que el inventario se recupere cuando Android vuelva a arrancar.
9. Repite con las variantes y versiones Android que la organización realmente soporte.

No hagas restablecimiento de fábrica, flasheo, cambio de bootloader ni operaciones sobre el teléfono de un cliente durante la validación inicial. Aunque los dos reinicios están protegidos por confirmación, requieren verificación física y supervisión antes de considerar el flujo aprobado. No se implementan bypasses de FRP, Knox, MDM, Google/Samsung Account ni bloqueos antirrobo.

## 9. Pruebas automáticas y verificación

Desde la raíz:

```powershell
pnpm -r test
pnpm -r build
```

Valida schema y migraciones Prisma:

```powershell
pnpm --filter @samsung-maintenance/api exec prisma validate
pnpm --filter @samsung-maintenance/api exec prisma migrate status
```

Las pruebas ADB usan ejecutores controlados para no requerir hardware ni enviar comandos a un teléfono real. Ejecuta primero las pruebas automatizadas; la prueba con un dispositivo se agrega como una etapa separada y supervisada.

## 10. Solución de problemas

| Síntoma | Revisión |
| --- | --- |
| API no inicia / error de Prisma | Revisa que PostgreSQL esté activo, `DATABASE_URL` sea correcto y `prisma migrate status` no reporte migraciones pendientes. |
| No se puede iniciar sesión | Usa el correo del administrador inicial; revisa que `create-admin` haya terminado correctamente y que la cuenta esté activa. |
| Agente rechaza la estación | `STATION_NAME` debe coincidir exactamente con una clave de `STATION_TOKENS`; el token debe ser idéntico y tener al menos 32 caracteres. |
| El agente no conecta | Comprueba `SERVER_URL`, que API esté arriba, firewall, `API_HOST` en despliegues LAN y que no haya proxy bloqueando Socket.IO/WebSocket. |
| ADB no encuentra el comando | Instala Platform-Tools oficiales y añade su carpeta al `PATH`; reinicia PowerShell y vuelve a ejecutar `adb version`. |
| Estado `unauthorized` | Desbloquea el teléfono con su propietario y acepta el diálogo de depuración USB; no se puede resolver desde el servidor. |
| El dispositivo no aparece actualizado | Espera un ciclo del agente (5 s), confirma el estado `device`, revisa logs de agente/API y que la estación registrada tenga el token esperado. |
| Diagnóstico parcial | Android puede restringir comandos o campos por versión/fabricante; usa el detalle de errores y no sustituyas lecturas desconocidas por datos estimados. |

## 11. Trabajo pendiente y límites conocidos

- Validación física de ADB, parsers y compatibilidad por versión/modelo Samsung.
- Validación física de los reinicios implementados. Restablecimiento de fábrica aún requiere diseñar un procedimiento compatible, autorizado, confirmado y auditado; no se ha habilitado.
- Catálogo de firmware basado únicamente en fuentes oficiales verificadas. No se inventan endpoints, URLs ni paquetes.
- Perfiles de aplicaciones con catálogo/fuentes verificadas e instalación transparente autorizada. No disponibles aún.
- Historial global, filtros y exportación de reportes de mantenimiento; hoy existe historial de diagnósticos por dispositivo, inventario y auditoría administrativa.
- Pruebas E2E con PostgreSQL desplegado, agente conectado y hardware real, más revisión de despliegue HTTPS/firewall.

Los requisitos de servicio externo, firmware, credenciales organizacionales o autorización del propietario se deben resolver por la organización. Si no hay fuente oficial o permiso, esa integración permanece deshabilitada.
