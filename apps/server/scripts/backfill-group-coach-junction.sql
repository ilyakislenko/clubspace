-- One-shot backfill after introducing GroupCoach (#multi-coach).
-- For every Group, materialise the existing primary coach into the
-- junction. ON CONFLICT keeps re-runs idempotent.
INSERT INTO "GroupCoach" ("groupId", "userId", "role", "createdAt")
SELECT g.id, g."coachId", 'primary', NOW()
FROM "Group" g
ON CONFLICT ("groupId", "userId") DO NOTHING;
