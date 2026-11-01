-- One-shot data migration for billing v2 (active-member tiers + paid modules).
-- Run ONCE against the existing database BEFORE the new server boots, after a
-- fresh backup:
--   psql "$DATABASE_URL" -f apps/server/scripts/migrate-billing-v2.sql
-- It maps the old Free/Club/Pro rows onto the new model and removes what the
-- new schema no longer has, so the `prisma db push` the server runs on boot is
-- purely additive (new columns with defaults, two new tables, one index).
--
-- Mapping: there is no forever-free plan any more and no club picks a tier —
-- the tier follows from its active members. Every club that is not suspended
-- starts a fresh trial (all modules on) lasting at least 30 days and never
-- ending before a period it already paid for, so nobody loses paid days or
-- video access overnight; the platform owner then sets modules, prices and
-- paid periods per club in the console. Suspended clubs stay suspended.
-- Clubs without a billing row get the same trial. Idempotent: a second run
-- finds no "planId" column and only tops up missing rows.

BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'WorkspaceBilling' AND column_name = 'planId'
    ) THEN
        UPDATE "WorkspaceBilling"
        SET status = 'TRIAL',
            "trialEndsAt" = GREATEST(
                NOW() + INTERVAL '30 days',
                COALESCE("trialEndsAt", NOW()),
                COALESCE("currentPeriodEnd", NOW())
            ),
            "currentPeriodEnd" = NULL,
            "pastDueSince" = NULL
        WHERE status <> 'SUSPENDED';

        ALTER TABLE "WorkspaceBilling" DROP COLUMN "planId";
    END IF;
END $$;

DROP TABLE IF EXISTS "PlatformPlan";

INSERT INTO "WorkspaceBilling" (id, "workspaceId", status, "trialEndsAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), w.id, 'TRIAL', NOW() + INTERVAL '30 days', NOW(), NOW()
FROM "Workspace" w
WHERE NOT EXISTS (
    SELECT 1 FROM "WorkspaceBilling" b WHERE b."workspaceId" = w.id
);

-- WorkspaceMember."lastSeenAt" becomes nullable (the new schema drops NOT
-- NULL and the default; db push does that itself). Existing values were only
-- ever the creation time, so they keep counting a recently added member as
-- active for 30 days at most — no backfill needed.

COMMIT;
