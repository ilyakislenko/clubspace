-- One-shot schema step for platform-admin TOTP: one authenticator per user and
-- type (TfaMethod @@unique([userId, type])) plus the replay guard column.
-- `prisma db push` refuses to add a unique constraint to a table that has rows
-- (it can't know there are no duplicates), so this runs BEFORE the push:
--   psql "$DATABASE_URL" -f apps/server/scripts/migrate-tfa-method-unique.sql
-- deploy/update.sh runs it automatically while the index is missing.
-- Idempotent. Before this release nothing created TfaMethod rows, so the
-- dedupe below normally has nothing to do; if it does, it keeps the enabled
-- method (else the newest-looking id) per user and type.

BEGIN;

ALTER TABLE "TfaMethod" ADD COLUMN IF NOT EXISTS "lastUsedTimeStep" INTEGER;

WITH ranked AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY "userId", type
               ORDER BY enabled DESC, id DESC
           ) AS rn
    FROM "TfaMethod"
),
dupes AS (SELECT id FROM ranked WHERE rn > 1)
DELETE FROM "TfaPermission" WHERE "methodId" IN (SELECT id FROM dupes);

WITH ranked AS (
    SELECT id,
           row_number() OVER (
               PARTITION BY "userId", type
               ORDER BY enabled DESC, id DESC
           ) AS rn
    FROM "TfaMethod"
)
DELETE FROM "TfaMethod" WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS "TfaMethod_userId_type_key"
    ON "TfaMethod" ("userId", type);

COMMIT;
