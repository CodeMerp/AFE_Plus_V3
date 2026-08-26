ALTER TABLE "heartrate_settings"
ADD COLUMN IF NOT EXISTS "min_enable" BOOLEAN NOT NULL DEFAULT true;
