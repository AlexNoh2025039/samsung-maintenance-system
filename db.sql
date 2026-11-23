-- Creación de Enums
CREATE TYPE "Role" AS ENUM ('ADMIN', 'TECHNICIAN');

CREATE TYPE "DeviceStateEnum" AS ENUM (
  'UNKNOWN',
  'ANDROID_INIT',
  'RECOVERY',
  'DOWNLOAD_MODE',
  'MAINTENANCE_IN_PROGRESS',
  'READY',
  'ERROR'
);

-- Tabla de Usuarios
CREATE TABLE "User" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  role "Role" DEFAULT 'TECHNICIAN' NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

-- Tabla de Estaciones de Trabajo
CREATE TABLE "Station" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  "machineName" TEXT NOT NULL,
  "isRegistered" BOOLEAN DEFAULT false NOT NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

-- Tabla de Dispositivos Samsung
CREATE TABLE "Device" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "serialNumber" TEXT UNIQUE NOT NULL,
  model TEXT,
  imei TEXT,
  "androidVersion" TEXT,
  "batteryLevel" INTEGER,
  state "DeviceStateEnum" DEFAULT 'UNKNOWN' NOT NULL,
  "stationId" UUID REFERENCES "Station"(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

-- Tabla de Historial de Operaciones (Mantenimiento, Resets, Flasheo)
CREATE TABLE "OperationHistory" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "deviceId" UUID REFERENCES "Device"(id) ON DELETE CASCADE NOT NULL,
  "operationType" TEXT NOT NULL, -- Ej: FACTORY_RESET, REBOOT_DOWNLOAD, FLASH
  status TEXT NOT NULL, -- PENDING, SUCCESS, FAILED
  details TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Tabla de Auditoría
CREATE TABLE "AuditLog" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID REFERENCES "User"(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details TEXT,
  "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
