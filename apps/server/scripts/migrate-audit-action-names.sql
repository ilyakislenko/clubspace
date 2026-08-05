-- One-shot migration to align AuditEvent.action values with the new
-- <entity>.<camelCaseVerb> convention introduced when the audit log got
-- enough multi-segment actions to need a stable parser. Safe to run
-- repeatedly — every UPDATE matches only the legacy form.
--
-- Run with:
--   docker exec -i clubspace-postgres-1 psql -U postgres -d clubspace < apps/server/scripts/migrate-audit-action-names.sql

UPDATE "AuditEvent" SET action = 'video.startUpload'      WHERE action = 'video.upload.create';
UPDATE "AuditEvent" SET action = 'video.completeUpload'   WHERE action = 'video.upload.complete';
UPDATE "AuditEvent" SET action = 'member.updateAccess'    WHERE action = 'member.access.update';
UPDATE "AuditEvent" SET action = 'member.updateRole'      WHERE action = 'member.role.update';
UPDATE "AuditEvent" SET action = 'group.addMember'        WHERE action = 'group.add_member';
UPDATE "AuditEvent" SET action = 'group.removeMember'     WHERE action = 'group.remove_member';
UPDATE "AuditEvent" SET action = 'workspace.updateSettings' WHERE action = 'workspace.settings.update';
