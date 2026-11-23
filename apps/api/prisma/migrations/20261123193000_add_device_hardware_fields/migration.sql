ALTER TABLE "Device" ALTER COLUMN "model" DROP NOT NULL;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "batteryLevel" INTEGER;
UPDATE "Device" SET "model" = NULL WHERE "model" = 'Samsung Device';
