import { Reflector } from '@nestjs/core'

// Organization (federation) staff roles — OrganizationMember.role. Not club
// roles: org staff never hold a WorkspaceMember row in the member clubs
// (docs/design/2026-11-26-federation-hub-mvp.md §1).
export type OrgRoleName = 'ORG_ADMIN' | 'ORG_COACH'

// Tiers of the org console. Every `orgs/:organizationId/*` route carries
// exactly one, and its handler repeats it with assertOrgAdmin / assertOrgStaff
// (pinned by shared/access/route-tier-consistency.spec.ts).
//
// ORG_ADMINS — clubs and team management, the org profile, announcements
//              (write), the audit journal.
// ORG_STAFF  — every org staff member: clubs and numbers (read), registry,
//              calendar, standards, announcements (read).
export const ORG_ADMINS: OrgRoleName[] = ['ORG_ADMIN']
export const ORG_STAFF: OrgRoleName[] = ['ORG_ADMIN', 'ORG_COACH']

// Read by OrganizationMemberGuard (handler first, then the class).
export const OrgRoles = Reflector.createDecorator<OrgRoleName[]>()
