CREATE TYPE "DiagnosticStatus" AS ENUM ('PENDING', 'SUCCESS', 'PARTIAL', 'FAILED');

CREATE TABLE "DeviceDiagnostic" (
    "id" TEXT NOT NULL,
    "status" "DiagnosticStatus" NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "errors" TEXT,
    "userId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "DeviceDiagnostic_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeviceDiagnostic_deviceId_createdAt_idx" ON "DeviceDiagnostic"("deviceId", "createdAt");
CREATE INDEX "DeviceDiagnostic_userId_createdAt_idx" ON "DeviceDiagnostic"("userId", "createdAt");

ALTER TABLE "DeviceDiagnostic"
ADD CONSTRAINT "DeviceDiagnostic_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeviceDiagnostic"
ADD CONSTRAINT "DeviceDiagnostic_stationId_fkey"
FOREIGN KEY ("stationId") REFERENCES "Station"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeviceDiagnostic"
ADD CONSTRAINT "DeviceDiagnostic_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
