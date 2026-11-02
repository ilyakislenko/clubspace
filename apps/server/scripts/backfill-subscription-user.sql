-- One-shot backfill after introducing Subscription.userId (abonements kept when
-- a membership is removed). Copies the holder from the member row, so a row
-- whose member is removed later still knows whose it was. Rows already
-- detached from a member (none before this change) stay null. Idempotent.
UPDATE "Subscription" s
SET "userId" = m."userId"
FROM "WorkspaceMember" m
WHERE s."workspaceMemberId" = m.id
  AND s."userId" IS NULL;
