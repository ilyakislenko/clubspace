import { ORG_SHARING_CONSENT_VERSION } from '../../../server/src/domains/organizations/consent'
import { RolesEnum } from '../../../server/src/shared/interfaces/shared.intefaces'
import { signIn, type Actor } from '../support/actors'
import { addMember, createGroupWithSlot, createUser, createWorkspace } from '../support/fixtures'
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

// ─── Tournaments (docs/design/2026-11-27-tournaments.md) ─────────────────

// A live federation consent written directly (the consent spec drives the
// API). `version` older than the tournament edition still covers the
// registry and plain registration, not an entry.
export const grantOrgConsent = async (
    ctx: TestApp,
    p: { organizationId: string; userId: string; version?: string },
) =>
    ctx.prisma.consentRecord.create({
        data: {
            userId: p.userId,
            organizationId: p.organizationId,
            kind: 'ORGANIZATION_SHARING',
            version: p.version ?? ORG_SHARING_CONSENT_VERSION,
        },
    })

type Club = { id: string }

// A federation (Tomsk) with an admin and a secretary (ORG_COACH), two member
// clubs — ACADEMY with a coach and their group, Беркут — and a COMPETITION
// event with its tournament, both created through the API.
export const setupTournament = async (ctx: TestApp, o: { matCount?: number } = {}) => {
    const http = () => ctx.http()
    const org = await createOrganization(ctx, { name: 'Федерация БЖЖ', timezone: 'Asia/Tomsk' })
    const staff = async (role: 'ORG_ADMIN' | 'ORG_COACH') => {
        const user = await createUser(ctx)
        await addOrgStaff(ctx, { organizationId: org.id, userId: user.id, role })
        return signIn(ctx, user.email!)
    }
    const orgAdmin = await staff('ORG_ADMIN')
    const secretary = await staff('ORG_COACH')
    const club = async (name: string) => {
        const { workspace, owner } = await createWorkspace(ctx, { name })
        await linkClub(ctx, { organizationId: org.id, workspaceId: workspace.id })
        return { workspace, owner }
    }
    const academy = await club('ACADEMY')
    const berkut = await club('Беркут')
    const coachUser = await createUser(ctx, { firstname: 'Тренер' })
    await addMember(ctx, { workspaceId: academy.workspace.id, userId: coachUser.id, role: RolesEnum.COACH })
    const coach = await signIn(ctx, coachUser.email!)
    const { group } = await createGroupWithSlot(ctx, {
        workspaceId: academy.workspace.id,
        coachUserId: coachUser.id,
        dayOfWeek: 2,
    })
    const event = (
        await http()
            .post(`/orgs/${org.id}/events`)
            .set(...orgAdmin.auth)
            .send({
                kind: 'COMPETITION',
                title: 'Кубок федерации',
                startAt: '2030-12-20T10:00',
                endAt: '2030-12-20T18:00',
                hostClubId: academy.workspace.id,
                capacity: null,
            })
            .expect(201)
    ).body as { id: string }
    const tournament = (
        await http()
            .post(`/orgs/${org.id}/events/${event.id}/tournament`)
            .set(...orgAdmin.auth)
            .send({ matCount: o.matCount ?? 1 })
            .expect(201)
    ).body as { id: string; status: string }
    return { org, orgAdmin, secretary, academy, berkut, coach, coachUser, group, event, tournament }
}
export type TournamentSetup = Awaited<ReturnType<typeof setupTournament>>

// Divisions through the API; returns them in creation order.
export const createDivisions = async (
    ctx: TestApp,
    s: TournamentSetup,
    rows: Array<Record<string, unknown>>,
) =>
    (
        await ctx
            .http()
            .post(`/orgs/${s.org.id}/tournaments/${s.tournament.id}/divisions`)
            .set(...s.orgAdmin.auth)
            .send({ rows })
            .expect(201)
    ).body.data as Array<{ id: string; name: string; mat: number | null }>

// A club member written directly: the user (named, born 2000), the
// membership, optionally in the coach's group and with the federation consent
// (`consent`: an edition string, or false for none).
export const clubPerson = async (
    ctx: TestApp,
    p: {
        organizationId: string
        club: Club
        firstname: string
        lastname: string
        groupId?: string
        consent?: false | string
    },
) => {
    const user = await createUser(ctx, { firstname: p.firstname })
    await ctx.prisma.user.update({
        where: { id: user.id },
        data: { lastname: p.lastname, dateOfBirth: new Date('2000-05-01T00:00:00Z') },
    })
    await addMember(ctx, { workspaceId: p.club.id, userId: user.id })
    if (p.groupId) await ctx.prisma.groupMember.create({ data: { groupId: p.groupId, userId: user.id } })
    if (p.consent !== false) {
        await grantOrgConsent(ctx, {
            organizationId: p.organizationId,
            userId: user.id,
            version: p.consent,
        })
    }
    return user
}

// A confirmed entrant written directly (booking + entry in `divisionId`), for
// specs whose subject is the weigh-in, the bracket or the results.
export const seedEntrant = async (
    ctx: TestApp,
    s: TournamentSetup,
    p: {
        club: Club
        firstname: string
        lastname: string
        divisionId: string | null
        weightKg?: number
        weighedKg?: number
        consent?: false | string
    },
) => {
    const user = await clubPerson(ctx, { organizationId: s.org.id, ...p })
    const registration = await ctx.prisma.organizationEventRegistration.create({
        data: { eventId: s.event.id, userId: user.id, workspaceId: p.club.id, status: 'BOOKED' },
    })
    const entry = await ctx.prisma.tournamentEntry.create({
        data: {
            tournamentId: s.tournament.id,
            registrationId: registration.id,
            userId: user.id,
            workspaceId: p.club.id,
            divisionId: p.divisionId,
            status: 'CONFIRMED',
            sex: 'MALE',
            birthYear: 2000,
            declaredWeightG: Math.round((p.weightKg ?? 75) * 1000),
            weighedWeightG: p.weighedKg === undefined ? null : Math.round(p.weighedKg * 1000),
            weighedAt: p.weighedKg === undefined ? null : new Date(),
            confirmedAt: new Date(),
        },
    })
    return { user, registration, entry }
}

// Signs a seeded person in (their own app session).
export const actorFor = (ctx: TestApp, user: { email: string | null }): Promise<Actor> =>
    signIn(ctx, user.email!)
