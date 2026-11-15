-- One-shot backfill for refunds (docs/design/2026-11-15-payments-journal.md §2,
-- phase B). Idempotent: every step touches only payments not yet carried over.
-- Revenue of clubs with refunded online abonements drops by those amounts (a
-- correction: the old full-refund endpoint left the abonement counted).

-- 1. The provider-side total of a payment refunded before this column existed:
--    the old endpoint only refunded in full.
UPDATE "Payment"
SET "refundedAmount" = amount
WHERE status = 'REFUNDED' AND "refundedAmount" = 0;

-- 2. Each refunded payment of a still-paid abonement becomes a Refund row
--    (method ONLINE, the payment's amount and refund date), recorded by the
--    actor of its `payment.refund` audit entry, else the club's owner; the
--    abonement's refundedAmount rises by it in the same statement. An
--    abonement staff unmarked since is no sale (nothing to subtract), and
--    refunded tickets get none: the old endpoint unmarked them.
WITH carried AS (
    INSERT INTO "Refund" (
        id, "workspaceId", "subscriptionId", "eventRegistrationId", "paymentId",
        "userId", "itemName", amount, currency, method, reason, "createdById",
        "refundedAt", "createdAt"
    )
    SELECT
        gen_random_uuid(),
        p."workspaceId",
        p."subscriptionId",
        NULL,
        p.id,
        COALESCE(s."userId", p."userId"),
        left(p."planName", 255),
        p.amount,
        p.currency,
        'ONLINE',
        'Возврат до журнала платежей',
        COALESCE(
            (
                SELECT a."actorId"
                FROM "AuditEvent" a
                WHERE a."workspaceId" = p."workspaceId"
                    AND a.action = 'payment.refund'
                    AND a.metadata->>'paymentId' = p.id::text
                    AND a."actorId" IS NOT NULL
                ORDER BY a."createdAt"
                LIMIT 1
            ),
            w."ownerId"
        ),
        COALESCE(p."refundedAt", p."updatedAt"),
        now()
    FROM "Payment" p
    JOIN "Subscription" s ON s.id = p."subscriptionId"
    JOIN "Workspace" w ON w.id = p."workspaceId"
    WHERE p.status = 'REFUNDED'
        AND s."isPaid"
        AND NOT EXISTS (SELECT 1 FROM "Refund" r WHERE r."paymentId" = p.id)
    RETURNING "subscriptionId", amount
)
UPDATE "Subscription" s
SET "refundedAmount" = LEAST(s."amountPaid", s."refundedAmount" + c.amount)
FROM carried c
WHERE s.id = c."subscriptionId";
