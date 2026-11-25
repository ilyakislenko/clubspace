import type { TestApp } from '../support/test-app'

// Federation hub fixtures (docs/design/2026-11-26-federation-hub-mvp.md):
// rows written directly, for specs whose subject is not the API that would
// create them (the membership spec drives invite/accept through the API).

let counter = 0
const uniq = (prefix: string) => `${prefix}-${Date.now()}-${counter++}`

export const createOrganization = async (
    ctx: TestApp,
    overrides: { name?: string; key?: string; timezone?: string } = {},
) =>
    ctx.prisma.organization.create({
        data: {
            key: overrides.key ?? uniq('org'),
            name: overrides.name ?? 'Test Federation',
            type: 'GRAPPLING',
            timezone: overrides.timezone ?? 'Europe/Moscow',
        },
    })

export const addOrgStaff = async (
    ctx: TestApp,
    params: { organizationId: string; userId: string; role?: 'ORG_ADMIN' | 'ORG_COACH' },
) =>
    ctx.prisma.organizationMember.create({
        data: {
            organizationId: params.organizationId,
            userId: params.userId,
            role: params.role ?? 'ORG_ADMIN',
        },
    })

export type ClubSharing = Partial<{
    shareRegistry: boolean
    shareMrr: boolean
    shareRevenue30d: boolean
    allowMemberAnnouncements: boolean
    allowMemberEvents: boolean
}>

// An ACTIVE membership by default (the club owner's acceptance already given).
export const linkClub = async (
    ctx: TestApp,
    params: {
        organizationId: string
        workspaceId: string
        status?: 'INVITED' | 'ACTIVE' | 'DECLINED' | 'LEFT' | 'REMOVED'
        sharing?: ClubSharing
    },
) =>
    ctx.prisma.organizationClub.create({
        data: {
            organizationId: params.organizationId,
            workspaceId: params.workspaceId,
            status: params.status ?? 'ACTIVE',
            decidedAt: (params.status ?? 'ACTIVE') === 'INVITED' ? null : new Date(),
            ...params.sharing,
        },
    })
