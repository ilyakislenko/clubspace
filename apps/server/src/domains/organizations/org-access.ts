// The one answer to «who may do what in an organization» (federation hub,
// docs/design/2026-11-26-federation-hub-mvp.md §3.1). Org staff are global
// users with an OrganizationMember row; the platform super admin acts as an
// org admin everywhere. A stranger gets 404, never a hint that the org exists.
import { Injectable } from '@nestjs/common'

import { environment } from '../../environments/environment'
import { PrismaService } from '../../infrastructure/prisma'
import type { OrgRoleName } from '../../shared/decorators/org-roles.decorator'
import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'

export type OrgScope = {
    organizationId: string
    userId: string
    role: OrgRoleName
    isSuperAdmin: boolean
}

export type OrgCaller = {
    userId: string
    organizationId: string
    isSuperAdmin: boolean
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ORG_NOT_FOUND = 'Федерация не найдена'

// ORGANIZATIONS_ENABLED off: the whole hub answers 404 (org routes, club-side
// federation routes, platform org routes).
export const assertOrganizationsEnabled = (): void => {
    if (!environment.organizations.enabled) {
        throw new NotFoundError({ message: 'Раздел не найден' })
    }
}

@Injectable()
export class OrgRbacService {
    constructor(private readonly prisma: PrismaService) {}

    async resolveOrgScope(p: OrgCaller): Promise<OrgScope> {
        assertOrganizationsEnabled()
        if (!UUID_RE.test(p.organizationId)) {
            throw new NotFoundError({ message: ORG_NOT_FOUND })
        }
        const [org, member] = await Promise.all([
            this.prisma.organization.findUnique({
                where: { id: p.organizationId },
                select: { isActive: true },
            }),
            p.isSuperAdmin
                ? Promise.resolve(null)
                : this.prisma.organizationMember.findUnique({
                      where: {
                          organizationId_userId: {
                              organizationId: p.organizationId,
                              userId: p.userId,
                          },
                      },
                      select: { role: true },
                  }),
        ])
        if (!org) throw new NotFoundError({ message: ORG_NOT_FOUND })
        if (p.isSuperAdmin) {
            return { ...p, role: 'ORG_ADMIN' }
        }
        // A switched-off org is closed to its staff (the platform keeps access).
        if (!member || !org.isActive) {
            throw new NotFoundError({ message: ORG_NOT_FOUND })
        }
        return { ...p, role: member.role }
    }
}

export const isOrgAdmin = (scope: Pick<OrgScope, 'role'>): boolean =>
    scope.role === 'ORG_ADMIN'

// ORG_ADMINS: clubs and team management, profile, announcements (write), audit.
export const assertOrgAdmin = async (
    orgRbac: OrgRbacService,
    caller: OrgCaller,
    message = 'Раздел доступен администраторам федерации',
): Promise<OrgScope> => {
    const scope = await orgRbac.resolveOrgScope(caller)
    if (!isOrgAdmin(scope)) throw new ForbiddenError({ message })
    return scope
}

// ORG_STAFF: any org staff member.
export const assertOrgStaff = async (
    orgRbac: OrgRbacService,
    caller: OrgCaller,
): Promise<OrgScope> => orgRbac.resolveOrgScope(caller)

// The clubs whose data the org may read: ACTIVE links only (an invited,
// declined, departed or removed club shares nothing).
export const activeClubIds = async (
    prisma: Pick<PrismaService, 'organizationClub'>,
    organizationId: string,
): Promise<string[]> =>
    (
        await prisma.organizationClub.findMany({
            where: { organizationId, status: 'ACTIVE' },
            select: { workspaceId: true },
        })
    ).map((l) => l.workspaceId)
