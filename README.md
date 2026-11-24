# Samsung Maintenance System

Sistema interno para administrar técnicos, estaciones de trabajo e inventario Samsung autorizado.

## Inicio rápido

1. Revisa [la guía de instalación, operación y pruebas](./docs/guia-instalacion-y-uso.md).
2. Prepara PostgreSQL y copia/configura `apps/api/.env.example` como `apps/api/.env`.
3. Ejecuta las migraciones Prisma y crea el primer administrador.
4. Inicia API, interfaz y agente local en terminales separadas.
5. Inicia sesión y conecta un teléfono Samsung autorizado cuando esté disponible.

## Estado

- Administración de usuarios, estaciones, inventario, sesiones y auditoría implementada.
- Agente ADB y sincronización Socket.IO implementados.
- Diagnóstico de solo lectura e historial por dispositivo implementados.
- Reinicio normal y reinicio a recovery implementados con confirmación exacta, control de rol y registro; pendientes de validación física.
- Builds y pruebas automatizadas disponibles con `pnpm -r build` y `pnpm -r test`.
- Las lecturas físicas todavía deben validarse con un dispositivo Samsung conectado y autorizado.
- Restablecimiento de fábrica, catálogo/instalación de firmware y perfiles de aplicaciones aún no están implementados. No se evaden FRP, Knox, MDM ni bloqueos antirrobo.

Consulta la guía para distinguir lo probado por automatización de lo pendiente en hardware.
