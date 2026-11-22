-- One-shot backfill for the payments journal (docs/design/2026-11-15-payments-journal.md
-- §2, phase A). Idempotent: every step touches only rows still missing the value.
-- Revenue doesn't move: step 1 writes the date revenue.ts paidOn() already used,
-- step 2 the method the serializers already showed.

-- 1. Paid abonements from before payment tracking carry no paidAt; their
--    revenue date was the sale date. The journal orders and filters on paidAt.
UPDATE "Subscription"
SET "paidAt" = "createdAt"
WHERE "isPaid" AND "paidAt" IS NULL;

-- 2. A checkout sale from before the method was stored was paid online.
UPDATE "Subscription"
SET "paymentMethod" = 'ONLINE'
WHERE "isPaid" AND source = 'GATEWAY' AND "paymentMethod" IS NULL;

-- 3. Who recorded a manual paid abonement: the actor of the nearest audit
--    entry of this club about this member that marked it paid (or sold it as
--    paid), within [paidAt − 5 s, paidAt + 60 s]. An entry naming another
--    abonement is not a match. No match stays NULL («не указано»).
UPDATE "Subscription" s
SET "markedPaidById" = m."actorId"
FROM (
    SELECT DISTINCT ON (s2.id) s2.id AS "subscriptionId", a."actorId"
    FROM "Subscription" s2
    JOIN "AuditEvent" a
        ON a."workspaceId" = s2."workspaceId"
        AND a."targetId" = s2."userId"::text
        AND a."actorId" IS NOT NULL
        AND (
            a.action = 'member.markSubscriptionPaid'
            OR (a.action = 'member.assignSubscription' AND a.metadata->>'paid' = 'true')
        )
        AND (a.metadata->>'subscriptionId' IS NULL OR a.metadata->>'subscriptionId' = s2.id::text)
        AND a."createdAt" BETWEEN s2."paidAt" - interval '5 seconds' AND s2."paidAt" + interval '60 seconds'
    WHERE s2."isPaid"
        AND s2.source = 'MANUAL'
        AND s2."markedPaidById" IS NULL
        AND s2."paidAt" IS NOT NULL
        AND s2."userId" IS NOT NULL
    ORDER BY s2.id, abs(extract(epoch FROM a."createdAt" - s2."paidAt")), a."createdAt"
) m
WHERE s.id = m."subscriptionId";
