-- One-shot data migration for parallel abonements (several current abonements
-- per member, a tariff scoped to a SET of directions).
-- Run ONCE against the existing database BEFORE the new server boots, after a
-- fresh backup:
--   psql "$DATABASE_URL" -f apps/server/scripts/migrate-parallel-abonements.sql
-- It moves the data the new schema keeps elsewhere and drops the two replaced
-- columns, so the `prisma db push` the server runs on boot is purely additive.
--
-- 1. Plan."directionId" → PlanDirection (one row per tagged tariff).
-- 2. Every abonement sold on a tagged tariff gets the same direction as its
--    scope snapshot (SubscriptionDirection) — until now the scope was read live
--    from the tariff, so this is exactly what each abonement is drawn by today.
-- 3. AttendanceRecord."usedSubscriptionId" (visit attribution) is backfilled
--    from "consumedSubscriptionId".
-- 4. WorkspaceMember."subscriptionId" (the single "current" pointer) goes: a
--    member's current abonements are now every ACTIVE, not-yet-ended row.
--    Rows the pointer had already left behind (an old bug repointed members
--    without closing the previous pack) would resurface as current, so live
--    ACTIVE rows that are not the pointed-at one are closed as EXPIRED —
--    except the abonement a back-to-back renewal follows (it ends by the day
--    the pointed-at one starts), which stays current until its own end.
-- Idempotent: a second run finds neither old column and changes nothing.

BEGIN;

CREATE TABLE IF NOT EXISTS "PlanDirection" (
    "planId" UUID NOT NULL,
    "directionId" UUID NOT NULL,
    CONSTRAINT "PlanDirection_pkey" PRIMARY KEY ("planId", "directionId")
);
CREATE INDEX IF NOT EXISTS "PlanDirection_directionId_idx" ON "PlanDirection"("directionId");

CREATE TABLE IF NOT EXISTS "SubscriptionDirection" (
    "subscriptionId" UUID NOT NULL,
    "directionId" UUID NOT NULL,
    CONSTRAINT "SubscriptionDirection_pkey" PRIMARY KEY ("subscriptionId", "directionId")
);
CREATE INDEX IF NOT EXISTS "SubscriptionDirection_directionId_idx" ON "SubscriptionDirection"("directionId");

ALTER TABLE "AttendanceRecord" ADD COLUMN IF NOT EXISTS "usedSubscriptionId" UUID;
CREATE INDEX IF NOT EXISTS "AttendanceRecord_usedSubscriptionId_idx" ON "AttendanceRecord"("usedSubscriptionId");

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlanDirection_planId_fkey') THEN
        ALTER TABLE "PlanDirection" ADD CONSTRAINT "PlanDirection_planId_fkey"
            FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PlanDirection_directionId_fkey') THEN
        ALTER TABLE "PlanDirection" ADD CONSTRAINT "PlanDirection_directionId_fkey"
            FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubscriptionDirection_subscriptionId_fkey') THEN
        ALTER TABLE "SubscriptionDirection" ADD CONSTRAINT "SubscriptionDirection_subscriptionId_fkey"
            FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SubscriptionDirection_directionId_fkey') THEN
        ALTER TABLE "SubscriptionDirection" ADD CONSTRAINT "SubscriptionDirection_directionId_fkey"
            FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AttendanceRecord_usedSubscriptionId_fkey') THEN
        ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_usedSubscriptionId_fkey"
            FOREIGN KEY ("usedSubscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Plan' AND column_name = 'directionId'
    ) THEN
        INSERT INTO "PlanDirection" ("planId", "directionId")
        SELECT p.id, p."directionId" FROM "Plan" p
        WHERE p."directionId" IS NOT NULL
        ON CONFLICT DO NOTHING;

        INSERT INTO "SubscriptionDirection" ("subscriptionId", "directionId")
        SELECT s.id, p."directionId"
        FROM "Subscription" s JOIN "Plan" p ON p.id = s."planId"
        WHERE p."directionId" IS NOT NULL
        ON CONFLICT DO NOTHING;

        UPDATE "AttendanceRecord"
        SET "usedSubscriptionId" = "consumedSubscriptionId"
        WHERE "usedSubscriptionId" IS NULL AND "consumedSubscriptionId" IS NOT NULL;

        ALTER TABLE "Plan" DROP COLUMN "directionId";
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'WorkspaceMember' AND column_name = 'subscriptionId'
    ) THEN
        UPDATE "Subscription" s
        SET status = 'EXPIRED', "updatedAt" = NOW()
        FROM "WorkspaceMember" m
        LEFT JOIN "Subscription" cur ON cur.id = m."subscriptionId"
        WHERE s."workspaceMemberId" = m.id
          AND s.status = 'ACTIVE'
          AND (s."endDate" IS NULL OR s."endDate" > NOW())
          AND s.id IS DISTINCT FROM m."subscriptionId"
          AND NOT (
              cur.id IS NOT NULL
              AND cur."startDate" IS NOT NULL
              AND s."endDate" IS NOT NULL
              AND s."endDate" <= cur."startDate" + INTERVAL '1 day'
          );

        ALTER TABLE "WorkspaceMember" DROP COLUMN "subscriptionId";
    END IF;
END $$;

COMMIT;
