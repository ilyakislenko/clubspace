jest.mock('../../../domains/tournaments/tournament-store', () => ({
    declareEntry: jest.fn(),
    confirmEntry: jest.fn(),
}))
jest.mock('../../../domains/organizations/registry', () => ({
    ...jest.requireActual('../../../domains/organizations/registry'),
    registryLevelsFor: jest.fn(),
}))

import {
    orgSharingConsentText,
    OrgConsentRequiredError,
    TOURNAMENT_CONSENT_MIN_VERSION,
} from '../../../domains/organizations/consent'
import { type RegistryLevel, registryLevelsFor } from '../../../domains/organizations/registry'
import { confirmEntry, declareEntry } from '../../../domains/tournaments/tournament-store'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import { RbacService } from '../../../shared/services/rbac.service'
import { ConfirmTournamentEntryHandler } from './confirm-tournament-entry.handler'
import {
    ConfirmTournamentEntryFeature,
    DeclareTournamentEntryFeature,
    GetClubTournamentBracketFeature,
    GetClubTournamentFeature,
    GetClubTournamentResultsFeature,
    ListClubTournamentAthletesFeature,
} from './club-tournaments.feature'
import { DeclareTournamentEntryHandler } from './declare-tournament-entry.handler'
import { GetClubTournamentBracketHandler } from './get-club-tournament-bracket.handler'
import { GetClubTournamentResultsHandler } from './get-club-tournament-results.handler'
import { GetClubTournamentHandler } from './get-club-tournament.handler'
import { ListClubTournamentAthletesHandler } from './list-club-tournament-athletes.handler'

// ─── Fixtures ────────────────────────────────────────────────────────────
// Prisma is an in-memory fake that filters by the handlers' `where`, so the
// club / scope / consent filters are exercised, not echoed. The two store
// transactions (declareEntry / confirmEntry) are mocked to write what the
// handler passed into the same fake, so the returned entry is what was written.

const W = 'w1'
const OTHER_W = 'w2'
const LEFT_W = 'w3'
const ORG = 'org1'
const CURRENT = TOURNAMENT_CONSENT_MIN_VERSION
const OLD = '2026-05-01.1'
const EVENT_START = new Date('2026-12-20T03:00:00Z')
const UPDATED = new Date('2026-11-20T00:00:00Z')
const DRAWN = new Date('2026-12-20T02:00:00Z')
const PUBLISHED = new Date('2026-12-21T10:00:00Z')

type TStatus = 'SETUP' | 'WEIGH_IN' | 'RUNNING' | 'FINISHED'
type Person = { firstname: string; lastname: string | null; dateOfBirth: Date | null }

const PEOPLE: Record<string, Person> = {
    stu: { firstname: 'Иван', lastname: 'Петров', dateOfBirth: new Date('2010-05-04T00:00:00Z') },
    ann: { firstname: 'Анна', lastname: 'Смирнова', dateOfBirth: null },
    kid: { firstname: 'Миша', lastname: 'Петров', dateOfBirth: new Date('2016-02-01T00:00:00Z') },
    mate: { firstname: 'Олег', lastname: 'Ким', dateOfBirth: new Date('2011-01-01T00:00:00Z') },
    guest: { firstname: 'Гость', lastname: 'Борисов', dateOfBirth: null },
    rival: { firstname: 'Пётр', lastname: 'Сидоров', dateOfBirth: new Date('2010-03-03T00:00:00Z') },
    ghost: { firstname: 'Скрытый', lastname: 'Человек', dateOfBirth: null },
    left: { firstname: 'Ушедший', lastname: 'Клуб', dateOfBirth: null },
}
const nameOf = (id: string) => `${PEOPLE[id].firstname} ${PEOPLE[id].lastname}`

const eventRow = () => ({
    id: 'e1',
    organizationId: ORG,
    kind: 'COMPETITION',
    title: 'Кубок федерации',
    description: null,
    startAt: EVENT_START,
    endAt: null,
    timezone: 'Asia/Tomsk',
    place: 'Олимп',
    address: null,
    audience: 'STAFF_AND_MEMBERS',
    capacity: 200,
    registrationOpen: true,
    registrationClosesAt: null,
    feeNote: null,
    publishedAt: new Date('2026-11-01T00:00:00Z'),
    organization: { name: 'Федерация' },
    hostWorkspace: { name: 'ACADEMY' },
})

const tournamentRow = (
    status: TStatus = 'SETUP',
    o: { closes?: Date; published?: Date; orgType?: string } = {},
) => ({
    id: 't1',
    organizationId: ORG,
    organization: { type: o.orgType ?? 'GRAPPLING' },
    eventId: 'e1',
    status,
    matCount: 2,
    resultsPublishedAt: o.published ?? null,
    createdAt: UPDATED,
    updatedAt: UPDATED,
    event: {
        title: 'Кубок федерации',
        startAt: EVENT_START,
        endAt: null,
        timezone: 'Asia/Tomsk',
        place: 'Олимп',
        registrationClosesAt: o.closes ?? null,
    },
})

const division = (o: Record<string, unknown> = {}) => ({
    id: 'd77',
    tournamentId: 't1',
    name: 'Мужчины до 77 кг',
    sortOrder: 1,
    sex: 'MALE',
    ageMin: null,
    ageMax: null,
    templateId: null,
    levelOrderFrom: null,
    levelOrderTo: null,
    levelLabel: null,
    weightMinG: 70000,
    weightMaxG: 77000,
    mat: null,
    matOrder: null,
    drawNo: 1,
    drawnAt: null,
    finishedAt: null,
    updatedAt: UPDATED,
    createdAt: UPDATED,
    ...o,
})
const PLAIN_DIVISIONS = [
    division(),
    division({ id: 'd85', name: 'Мужчины до 85 кг', sortOrder: 2, weightMinG: 77000, weightMaxG: 85000 }),
]
// Two divisions on the federation standard: a level is needed to place anyone.
const STANDARD_DIVISIONS = [
    division({ id: 'dLow', name: 'Белый–синий до 77', templateId: 'tpl1', levelOrderFrom: 0, levelOrderTo: 2 }),
    division({ id: 'dHigh', name: 'Фиолетовый+ до 77', templateId: 'tpl1', levelOrderFrom: 3, levelOrderTo: 9 }),
]

const entry = (userId: string, o: Record<string, unknown> = {}) => ({
    id: `en-${userId}`,
    tournamentId: 't1',
    registrationId: `r-${userId}`,
    userId,
    workspaceId: W,
    status: 'DECLARED',
    sex: 'MALE',
    birthYear: 2010,
    declaredWeightG: 76500,
    weighedWeightG: null as number | null,
    weighedAt: null,
    divisionId: null as string | null,
    templateLevelId: null as string | null,
    levelName: null as string | null,
    levelSetById: null as string | null,
    confirmedAt: null,
    withdrawnReason: null,
    place: null as number | null,
    updatedAt: UPDATED,
    user: { firstname: PEOPLE[userId].firstname, lastname: PEOPLE[userId].lastname },
    workspace: { name: { [W]: 'ACADEMY', [OTHER_W]: 'Боевой дух', [LEFT_W]: 'Бывший клуб' }[(o.workspaceId as string) ?? W] },
    ...o,
})
type EntryRow = ReturnType<typeof entry>

type Match = {
    id: string
    tournamentId: string
    divisionId: string
    round: number
    position: number
    entryAId: string | null
    entryBId: string | null
    isBye: boolean
    winnerEntryId: string | null
    method: string | null
    scoreA: number | null
    scoreB: number | null
    note: string | null
    decidedAt: Date | null
    updatedAt: Date
}
const match = (o: Partial<Match> & Pick<Match, 'id' | 'round' | 'position'>): Match => ({
    tournamentId: 't1',
    divisionId: 'd77',
    entryAId: null,
    entryBId: null,
    isBye: false,
    winnerEntryId: null,
    method: null,
    scoreA: null,
    scoreB: null,
    note: null,
    decidedAt: null,
    updatedAt: UPDATED,
    ...o,
})

type Db = {
    ownerId: string
    seesAll: boolean
    event: ReturnType<typeof eventRow> | null
    tournament: ReturnType<typeof tournamentRow> | null
    registrations: Array<{ id: string; eventId: string; userId: string; workspaceId: string; status: string }>
    consents: Array<{ userId: string; dependentId: string | null; version: string }>
    guardianships: Array<{ guardianId: string; dependentId: string }>
    activeClubs: string[]
    // Groups of this club: who coaches them and who trains there.
    groups: Array<{ coachId: string; studentIds: string[] }>
    divisions: Array<ReturnType<typeof division>>
    entries: EntryRow[]
    matches: Match[]
    templates: Array<{ id: string; name: string; levels: Array<{ id: string; name: string; order: number }> }>
    levels: Array<{ id: string; templateId: string; order: number; name: string }>
}

const booking = (userId: string, workspaceId = W, status = 'BOOKED') => ({
    id: `r-${userId}`,
    eventId: 'e1',
    userId,
    workspaceId,
    status,
})

type Filter = string | number | null | { in?: unknown[]; not?: unknown } | undefined
const fits = (value: unknown, f: Filter) => {
    if (f === undefined) return true
    if (f !== null && typeof f === 'object') {
        if (f.in) return f.in.includes(value)
        if ('not' in f) return value !== f.not
        return true
    }
    return value === f
}
const fitsAll = (row: Record<string, unknown>, where: Record<string, Filter>, keys: string[]) =>
    keys.every((k) => fits(row[k], where[k]))
const ENTRY_KEYS = ['tournamentId', 'id', 'divisionId', 'workspaceId', 'userId', 'place', 'status']
const userRow = (id: string) => ({ id, ...PEOPLE[id] })

const makePrisma = (o: Partial<Db> = {}) => {
    const db: Db = {
        ownerId: 'owner',
        seesAll: false,
        event: eventRow(),
        tournament: tournamentRow(),
        registrations: [booking('stu')],
        consents: [{ userId: 'stu', dependentId: null, version: CURRENT }],
        guardianships: [],
        activeClubs: [W, OTHER_W],
        groups: [
            { coachId: 'coach', studentIds: ['stu', 'mate'] },
            { coachId: 'coach2', studentIds: ['ann'] },
        ],
        divisions: PLAIN_DIVISIONS,
        entries: [],
        matches: [],
        templates: [],
        levels: [],
        ...o,
    }
    const entriesWhere = (where: Record<string, Filter>) =>
        db.entries.filter((e) => fitsAll(e, where, ENTRY_KEYS))
    const prisma = {
        db,
        workspace: {
            findUnique: jest.fn(async () => ({ ownerId: db.ownerId, coachSeesAllGroups: db.seesAll })),
        },
        organizationEvent: { findFirst: jest.fn(async (_args: { where: { OR: unknown[] } }) => db.event) },
        tournament: {
            findUnique: jest.fn(async ({ where }: { where: { eventId: string } }) =>
                db.tournament?.eventId === where.eventId ? db.tournament : null,
            ),
        },
        organizationEventRegistration: {
            findFirst: jest.fn(async ({ where }: { where: Record<string, Filter> }) => {
                const r = db.registrations.find((r) =>
                    fitsAll(r, where, ['eventId', 'userId', 'workspaceId', 'status']),
                )
                return r ? { id: r.id } : null
            }),
            findMany: jest.fn(async ({ where }: { where: Record<string, Filter> }) =>
                db.registrations
                    .filter((r) => fitsAll(r, where, ['eventId', 'workspaceId', 'status']))
                    .map((r) => ({ id: r.id, userId: r.userId, user: userRow(r.userId) })),
            ),
        },
        user: {
            findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
                PEOPLE[where.id] ? { dateOfBirth: PEOPLE[where.id].dateOfBirth } : null,
            ),
        },
        consentRecord: {
            findMany: jest.fn(
                async ({ where }: { where: { OR: [{ userId: { in: string[] } }, { dependentId: { in: string[] } }] } }) =>
                    db.consents.filter((c) =>
                        c.dependentId === null
                            ? where.OR[0].userId.in.includes(c.userId)
                            : where.OR[1].dependentId.in.includes(c.dependentId),
                    ),
            ),
        },
        guardianship: {
            findMany: jest.fn(async ({ where }: { where: { dependentId: { in: string[] } } }) =>
                db.guardianships.filter((g) => where.dependentId.in.includes(g.dependentId)),
            ),
        },
        organizationClub: {
            findMany: jest.fn(async () => db.activeClubs.map((workspaceId) => ({ workspaceId }))),
        },
        groupMember: {
            // isMemberInOwnGroups: a group of this coach with the student in it.
            findFirst: jest.fn(
                async ({ where }: { where: { userId: string; group: { OR: [{ coaches: { some: { userId: string } } }] } } }) => {
                    const coachId = where.group.OR[0].coaches.some.userId
                    return db.groups.some((g) => g.coachId === coachId && g.studentIds.includes(where.userId))
                        ? { groupId: 'g1' }
                        : null
                },
            ),
            // Own groups (ownGroupsWhere) or every group of the club,
            // optionally narrowed to some people.
            findMany: jest.fn(
                async ({
                    where,
                    select,
                }: {
                    where: {
                        userId?: { in: string[] }
                        group: { workspaceId: string; OR?: [{ coaches: { some: { userId: string } } }] }
                    }
                    select: { user?: unknown; userId?: unknown }
                }) => {
                    const coachId = where.group.OR?.[0].coaches.some.userId
                    const ids = [
                        ...new Set(
                            db.groups.filter((g) => !coachId || g.coachId === coachId).flatMap((g) => g.studentIds),
                        ),
                    ].filter((id) => fits(id, where.userId))
                    return select.user ? ids.map((id) => ({ user: userRow(id) })) : ids.map((userId) => ({ userId }))
                },
            ),
        },
        tournamentDivision: {
            findMany: jest.fn(async ({ where }: { where: Record<string, Filter> }) =>
                db.divisions.filter((d) => fitsAll(d, where, ['tournamentId', 'id'])),
            ),
        },
        tournamentEntry: {
            findMany: jest.fn(async ({ where }: { where: Record<string, Filter> }) => entriesWhere(where)),
            findFirst: jest.fn(async ({ where }: { where: { id: string; workspaceId: string } }) => {
                const e = db.entries.find((e) => e.id === where.id && e.workspaceId === where.workspaceId)
                return e
                    ? {
                          id: e.id,
                          userId: e.userId,
                          sex: e.sex,
                          birthYear: e.birthYear,
                          declaredWeightG: e.declaredWeightG,
                          weighedWeightG: e.weighedWeightG,
                          tournament: db.tournament,
                      }
                    : null
            }),
            groupBy: jest.fn(async ({ by, where }: { by: [keyof EntryRow]; where: Record<string, Filter> }) => {
                const counts = new Map<unknown, number>()
                for (const e of entriesWhere(where)) counts.set(e[by[0]], (counts.get(e[by[0]]) ?? 0) + 1)
                return [...counts].map(([k, n]) => ({ [by[0]]: k, _count: { _all: n } }))
            }),
        },
        tournamentMatch: {
            findMany: jest.fn(async ({ where }: { where: Record<string, Filter> }) =>
                db.matches
                    .filter((m) => fitsAll(m, where, ['tournamentId', 'divisionId']))
                    .sort((a, b) => a.round - b.round || a.position - b.position),
            ),
            groupBy: jest.fn(async () => []),
        },
        organizationLadderTemplate: {
            findMany: jest.fn(async ({ where }: { where: Record<string, Filter> }) =>
                db.templates.filter((t) => fits(t.id, where.id)),
            ),
        },
        organizationLadderTemplateLevel: {
            findMany: jest.fn(async ({ where }: { where: Record<string, Filter> }) =>
                db.levels.filter((l) => fits(l.id, where.id)),
            ),
        },
    }
    return prisma
}
type FakePrisma = ReturnType<typeof makePrisma>

const mockedDeclare = jest.mocked(declareEntry)
const mockedConfirm = jest.mocked(confirmEntry)
const mockedRegistry = jest.mocked(registryLevelsFor)

const PURPLE: RegistryLevel = { templateLevelId: 'lvl-purple', templateId: 'tpl1', order: 4, name: 'Фиолетовый' }
const LEVELS = [
    { id: 'lvl-white', templateId: 'tpl1', order: 0, name: 'Белый' },
    { id: 'lvl-blue', templateId: 'tpl1', order: 1, name: 'Синий' },
    { id: 'lvl-purple', templateId: 'tpl1', order: 4, name: 'Фиолетовый' },
]

beforeEach(() => {
    jest.clearAllMocks()
    mockedRegistry.mockResolvedValue(new Map())
    // The store's contract: an entry per registration, CONFIRMED with the
    // confirmation's level/division when one is passed, else DECLARED.
    mockedDeclare.mockImplementation(async (prisma, p) => {
        const db = (prisma as unknown as FakePrisma).db
        const existing = db.entries.find((e) => e.registrationId === p.registrationId)
        const c = p.confirmation
        const row = {
            ...(existing ?? entry(p.userId, { registrationId: p.registrationId, workspaceId: p.workspaceId })),
            sex: p.sex,
            birthYear: p.birthYear,
            declaredWeightG: p.declaredWeightG,
            status: c ? 'CONFIRMED' : 'DECLARED',
            divisionId: c?.divisionId ?? null,
            templateLevelId: c?.templateLevelId ?? null,
            levelName: c?.levelName ?? null,
            levelSetById: c?.levelSetById ?? null,
        }
        db.entries = [...db.entries.filter((e) => e !== existing), row]
        return { entryId: row.id, created: !existing }
    })
    mockedConfirm.mockImplementation(async (prisma, p) => {
        const db = (prisma as unknown as FakePrisma).db
        db.entries = db.entries.map((e) =>
            e.id === p.entryId
                ? {
                      ...e,
                      status: 'CONFIRMED',
                      divisionId: p.confirmation.divisionId,
                      templateLevelId: p.confirmation.templateLevelId,
                      levelName: p.confirmation.levelName,
                      levelSetById: p.confirmation.levelSetById,
                  }
                : e,
        )
    })
})

const services = () => ({
    audit: { record: jest.fn() },
    realtime: { invalidate: jest.fn() },
})

type Who = { invoker?: string; guardianId?: string | null; role?: string | null; superAdmin?: boolean }
const roleOf = (w: Who, fallback: string | null) => (w.role === undefined ? fallback : w.role)

// Recursively every key and every leaf value of a payload.
const scan = (v: unknown, keys: Set<string> = new Set(), leaves: unknown[] = []) => {
    if (Array.isArray(v)) v.forEach((x) => scan(x, keys, leaves))
    else if (v !== null && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
            keys.add(k)
            scan(x, keys, leaves)
        }
    } else leaves.push(v)
    return { keys, leaves }
}

// ─── getClubTournament ───────────────────────────────────────────────────

describe('getClubTournament', () => {
    const run = (prisma: FakePrisma, w: Who = {}) =>
        new GetClubTournamentHandler(prisma as never, new RbacService(prisma as never)).execute(
            new GetClubTournamentFeature(
                W,
                'e1',
                w.invoker ?? 'stu',
                w.guardianId ?? null,
                roleOf(w, 'user'),
                w.superAdmin ?? false,
            ),
        )

    it("shows a member their own entry with weights, the consent state and no staff count", async () => {
        const prisma = makePrisma({
            entries: [entry('stu', { status: 'CONFIRMED', divisionId: 'd77', weighedWeightG: 76200 })],
        })
        const out = await run(prisma)
        expect(out).toMatchObject({
            id: 't1',
            eventId: 'e1',
            organizationId: ORG,
            organizationName: 'Федерация',
            eventTitle: 'Кубок федерации',
            status: 'SETUP',
            myRegistrationId: 'r-stu',
            canDeclare: true,
            profileBirthYear: 2010,
            consentCurrent: true,
            consentText: orgSharingConsentText('Федерация', false),
            levels: [],
            toConfirmCount: null,
        })
        expect(out.myEntry).toMatchObject({
            id: 'en-stu',
            userId: 'stu',
            status: 'CONFIRMED',
            declaredWeightKg: 76.5,
            weighedWeightKg: 76.2,
            divisionName: 'Мужчины до 77 кг',
            bracketAvailable: false,
            nextMatch: null,
        })
        // Own entry in this club only; a member sees member-audience events.
        expect(prisma.tournamentEntry.findMany.mock.calls[0][0].where).toMatchObject({
            tournamentId: 't1',
            workspaceId: W,
            userId: { in: ['stu'] },
        })
        expect(prisma.organizationEvent.findFirst.mock.calls[0][0].where.OR).toHaveLength(1)
        expect(prisma.tournamentEntry.groupBy).not.toHaveBeenCalled()
    })

    it("shows a guardian acting for a child the child's entry, consent and the guardian wording", async () => {
        const prisma = makePrisma({
            registrations: [booking('kid')],
            consents: [{ userId: 'parent', dependentId: 'kid', version: CURRENT }],
            guardianships: [{ guardianId: 'parent', dependentId: 'kid' }],
            entries: [entry('kid', { birthYear: 2016, declaredWeightG: 32000 })],
        })
        const out = await run(prisma, { invoker: 'kid', guardianId: 'parent' })
        expect(out).toMatchObject({
            myRegistrationId: 'r-kid',
            profileBirthYear: 2016,
            consentCurrent: true,
            consentText: orgSharingConsentText('Федерация', true),
            myEntry: { userId: 'kid', status: 'DECLARED', birthYear: 2016, declaredWeightKg: 32 },
        })
        expect(prisma.organizationEventRegistration.findFirst.mock.calls[0][0].where).toMatchObject({
            userId: 'kid',
            workspaceId: W,
            status: 'BOOKED',
        })
    })

    it('reports an older consent edition, no booking and no entry', async () => {
        const out = await run(
            makePrisma({ registrations: [], consents: [{ userId: 'stu', dependentId: null, version: OLD }] }),
        )
        expect(out).toMatchObject({
            consentCurrent: false,
            myRegistrationId: null,
            myEntry: null,
            canDeclare: false,
        })
    })

    it('closes declaring after the deadline and once weigh-in started', async () => {
        const past = new Date(Date.now() - 60_000)
        await expect(run(makePrisma({ tournament: tournamentRow('SETUP', { closes: past }) }))).resolves.toMatchObject({
            canDeclare: false,
        })
        await expect(run(makePrisma({ tournament: tournamentRow('WEIGH_IN') }))).resolves.toMatchObject({
            canDeclare: false,
            status: 'WEIGH_IN',
        })
    })

    it('lists the levels of the standards the divisions use', async () => {
        const prisma = makePrisma({
            divisions: STANDARD_DIVISIONS,
            templates: [
                {
                    id: 'tpl1',
                    name: 'Стандарт БЖЖ',
                    levels: [
                        { id: 'lvl-white', name: 'Белый', order: 0 },
                        { id: 'lvl-blue', name: 'Синий', order: 1 },
                    ],
                },
            ],
        })
        const out = await run(prisma)
        expect(out.levels).toEqual([
            { id: 'lvl-white', name: 'Белый', order: 0, templateId: 'tpl1', templateName: 'Стандарт БЖЖ' },
            { id: 'lvl-blue', name: 'Синий', order: 1, templateId: 'tpl1', templateName: 'Стандарт БЖЖ' },
        ])
        expect(prisma.organizationLadderTemplate.findMany.mock.calls[0][0].where).toEqual({
            id: { in: ['tpl1'] },
            organizationId: ORG,
        })
    })

    it("counts a coach's own students' entries to confirm", async () => {
        const prisma = makePrisma({
            entries: [entry('stu'), entry('ann'), entry('mate', { status: 'CONFIRMED' })],
        })
        const out = await run(prisma, { invoker: 'coach', role: 'coach' })
        expect(out.toConfirmCount).toBe(1)
        expect(prisma.tournamentEntry.groupBy.mock.calls[0][0].where).toMatchObject({
            workspaceId: W,
            status: 'DECLARED',
            userId: { in: ['stu', 'mate'] },
        })
        // Staff also see the coaches-only events.
        expect(prisma.organizationEvent.findFirst.mock.calls[0][0].where.OR).toHaveLength(2)
    })

    it('counts the whole club for an admin, a head coach and the owner (no member row)', async () => {
        const entries = [entry('stu'), entry('ann')]
        for (const w of [
            { invoker: 'adm', role: 'admin' },
            { invoker: 'head', role: 'head_coach' },
            { invoker: 'owner', role: null },
        ]) {
            const prisma = makePrisma({ entries })
            await expect(run(prisma, w)).resolves.toMatchObject({ toConfirmCount: 2 })
            expect(prisma.tournamentEntry.groupBy.mock.calls[0][0].where.userId).toBeUndefined()
        }
    })

    it('gives a coach without groups a zero count', async () => {
        const out = await run(makePrisma({ entries: [entry('stu')], groups: [] }), {
            invoker: 'coach',
            role: 'coach',
        })
        expect(out.toConfirmCount).toBe(0)
    })

    it('treats a super-admin without a club role as a member viewer', async () => {
        const prisma = makePrisma({ entries: [entry('stu')] })
        const out = await run(prisma, { invoker: 'root', role: null, superAdmin: true })
        expect(out).toMatchObject({ myEntry: null, toConfirmCount: null })
    })

    it('shows the next match of a running tournament with names per consent', async () => {
        const out = await run(makePrisma(runningDb()))
        expect(out.myEntry).toMatchObject({ status: 'CONFIRMED', bracketAvailable: true })
        expect(out.myEntry?.nextMatch).toEqual({
            mat: 1,
            ahead: null,
            opponent: null,
            waitingFor: {
                entryA: { hidden: false, personName: nameOf('rival'), clubName: 'Боевой дух', isMe: false, isMyClub: false },
                // A teammate without the consent: hidden from a plain member,
                // and a hidden person never carries the club mark.
                entryB: { hidden: true, personName: null, clubName: null, isMe: false, isMyClub: false },
            },
        })
    })

    it('answers 404 for an event this club does not get and for an event without a tournament', async () => {
        await expect(run(makePrisma({ event: null }))).rejects.toBeInstanceOf(NotFoundError)
        await expect(run(makePrisma({ tournament: null }))).rejects.toBeInstanceOf(NotFoundError)
    })
})

// A running division: stu beat ghost, rival vs mate is on mat 1, stu waits
// for that winner in the final.
const runningDb = (status: TStatus = 'RUNNING'): Partial<Db> => ({
    tournament: tournamentRow(status, status === 'FINISHED' ? { published: PUBLISHED } : {}),
    divisions: [division({ mat: 1, matOrder: 1, drawnAt: DRAWN }), division({ id: 'd85', name: 'Мужчины до 85 кг', sortOrder: 2, drawnAt: DRAWN })],
    consents: [
        { userId: 'stu', dependentId: null, version: CURRENT },
        { userId: 'rival', dependentId: null, version: CURRENT },
        { userId: 'left', dependentId: null, version: CURRENT },
        // An old edition counts for the registry, not for a tournament.
        { userId: 'ghost', dependentId: null, version: OLD },
    ],
    entries: [
        entry('stu', { status: 'CONFIRMED', divisionId: 'd77', weighedWeightG: 76200, birthYear: 2010 }),
        entry('mate', { status: 'CONFIRMED', divisionId: 'd77', weighedWeightG: 75100, birthYear: 2011 }),
        entry('rival', { status: 'CONFIRMED', divisionId: 'd77', workspaceId: OTHER_W, weighedWeightG: 76900, birthYear: 2009 }),
        entry('ghost', { status: 'CONFIRMED', divisionId: 'd77', workspaceId: OTHER_W, weighedWeightG: 74300, birthYear: 2012, place: 3 }),
    ],
    matches: [
        match({
            id: 'm1',
            round: 1,
            position: 1,
            entryAId: 'en-stu',
            entryBId: 'en-ghost',
            winnerEntryId: 'en-stu',
            method: 'POINTS',
            scoreA: 4,
            scoreB: 0,
            decidedAt: new Date('2026-12-20T05:00:00Z'),
        }),
        match({ id: 'm2', round: 1, position: 2, entryAId: 'en-rival', entryBId: 'en-mate' }),
        match({ id: 'm3', round: 2, position: 1, entryAId: 'en-stu' }),
    ],
})

// ─── declareTournamentEntry ──────────────────────────────────────────────

describe('declareTournamentEntry', () => {
    const run = (
        prisma: FakePrisma,
        payload: { userId?: string; declaredWeightKg?: number; sex?: 'MALE' | 'FEMALE'; birthYear?: number } = {},
        w: Who = {},
    ) => {
        const s = services()
        const handler = new DeclareTournamentEntryHandler(
            prisma as never,
            new RbacService(prisma as never),
            s.audit as never,
            s.realtime as never,
        )
        return {
            ...s,
            result: handler.execute(
                new DeclareTournamentEntryFeature(
                    { declaredWeightKg: 76.5, sex: 'MALE', ...payload },
                    W,
                    'e1',
                    w.invoker ?? 'stu',
                    w.guardianId ?? null,
                    roleOf(w, 'user'),
                    w.superAdmin ?? false,
                ),
            ),
        }
    }
    const declared = () => mockedDeclare.mock.calls[0][1]

    it('lets a member declare themself: DECLARED, birth year from the profile', async () => {
        const prisma = makePrisma()
        const { result, audit, realtime } = run(prisma)
        await expect(result).resolves.toMatchObject({
            id: 'en-stu',
            userId: 'stu',
            status: 'DECLARED',
            sex: 'MALE',
            birthYear: 2010,
            declaredWeightKg: 76.5,
            divisionId: null,
            divisionName: null,
        })
        expect(declared()).toMatchObject({
            tournamentId: 't1',
            registrationId: 'r-stu',
            userId: 'stu',
            workspaceId: W,
            sex: 'MALE',
            birthYear: 2010,
            declaredWeightG: 76500,
            declaredById: 'stu',
            confirmation: null,
        })
        // No coach check for oneself.
        expect(prisma.groupMember.findFirst).not.toHaveBeenCalled()
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'tournament.entryDeclare',
                actorId: 'stu',
                workspaceId: W,
                organizationId: ORG,
                metadata: expect.objectContaining({ entryId: 'en-stu', byCoach: false }),
            }),
        )
        expect(realtime.invalidate).toHaveBeenCalledWith(W, ['organizations'])
    })

    it('takes a typed birth year, requires one when the profile has none, and checks it', async () => {
        const typed = run(makePrisma(), { birthYear: 2011 })
        await expect(typed.result).resolves.toMatchObject({ birthYear: 2011 })
        expect(declared().birthYear).toBe(2011)

        const annDb = () =>
            makePrisma({
                registrations: [booking('ann')],
                consents: [{ userId: 'ann', dependentId: null, version: CURRENT }],
            })
        const missing = run(annDb(), {}, { invoker: 'ann' })
        await expect(missing.result).rejects.toMatchObject({ message: 'Укажите год рождения' })
        await expect(missing.result).rejects.toBeInstanceOf(BadRequestError)
        const future = run(annDb(), { birthYear: new Date().getUTCFullYear() + 1 }, { invoker: 'ann' })
        await expect(future.result).rejects.toBeInstanceOf(BadRequestError)
        const ok = run(annDb(), { birthYear: 2012 }, { invoker: 'ann' })
        await expect(ok.result).resolves.toMatchObject({ userId: 'ann', birthYear: 2012 })
    })

    it('lets a guardian declare their child, recorded as the guardian', async () => {
        const prisma = makePrisma({
            registrations: [booking('kid')],
            consents: [{ userId: 'parent', dependentId: 'kid', version: CURRENT }],
            guardianships: [{ guardianId: 'parent', dependentId: 'kid' }],
        })
        const { result, audit } = run(prisma, { declaredWeightKg: 32 }, { invoker: 'kid', guardianId: 'parent' })
        await expect(result).resolves.toMatchObject({ userId: 'kid', status: 'DECLARED', birthYear: 2016 })
        expect(declared()).toMatchObject({
            userId: 'kid',
            registrationId: 'r-kid',
            declaredById: 'parent',
            declaredWeightG: 32000,
            confirmation: null,
        })
        expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'parent' }))
    })

    it('confirms at once with the matching division when a coach declares their student', async () => {
        const prisma = makePrisma()
        const { result, audit } = run(prisma, { userId: 'stu' }, { invoker: 'coach', role: 'coach' })
        await expect(result).resolves.toMatchObject({
            userId: 'stu',
            status: 'CONFIRMED',
            divisionId: 'd77',
            divisionName: 'Мужчины до 77 кг',
        })
        expect(declared()).toMatchObject({
            userId: 'stu',
            declaredById: 'coach',
            confirmation: {
                confirmedById: 'coach',
                templateLevelId: null,
                levelName: null,
                levelSetById: null,
                divisionId: 'd77',
            },
        })
        expect(mockedRegistry).toHaveBeenCalledWith(prisma, ORG, ['stu'])
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ actorId: 'coach', metadata: expect.objectContaining({ byCoach: true }) }),
        )
    })

    it('takes the registry level for a coach declaration and leaves no fit to the federation', async () => {
        mockedRegistry.mockResolvedValue(new Map([['stu', PURPLE]]))
        const withLevel = run(makePrisma({ divisions: STANDARD_DIVISIONS }), { userId: 'stu' }, { invoker: 'coach', role: 'coach' })
        await expect(withLevel.result).resolves.toMatchObject({ divisionId: 'dHigh', levelName: 'Фиолетовый' })
        // No standard level known and not required here: confirmed, no division.
        mockedRegistry.mockResolvedValue(new Map())
        mockedDeclare.mockClear()
        const noFit = run(makePrisma({ divisions: STANDARD_DIVISIONS }), { userId: 'stu' }, { invoker: 'coach', role: 'coach' })
        await expect(noFit.result).resolves.toMatchObject({ status: 'CONFIRMED', divisionId: null, levelName: null })
        expect(declared().confirmation).toMatchObject({ divisionId: null, templateLevelId: null })
    })

    it('refuses a coach a student of another group, and a member declaring someone else (403)', async () => {
        const foreign = run(
            makePrisma({ registrations: [booking('ann')], consents: [{ userId: 'ann', dependentId: null, version: CURRENT }] }),
            { userId: 'ann', birthYear: 2012 },
            { invoker: 'coach', role: 'coach' },
        )
        await expect(foreign.result).rejects.toBeInstanceOf(ForbiddenError)
        const member = run(makePrisma(), { userId: 'stu' }, { invoker: 'mate', role: 'user' })
        await expect(member.result).rejects.toBeInstanceOf(ForbiddenError)
        expect(mockedDeclare).not.toHaveBeenCalled()
    })

    it('lets the owner (no member row), a head coach and a super-admin declare any student', async () => {
        const annDb = () =>
            makePrisma({ registrations: [booking('ann')], consents: [{ userId: 'ann', dependentId: null, version: CURRENT }] })
        for (const w of [
            { invoker: 'owner', role: null },
            { invoker: 'head', role: 'head_coach' },
            { invoker: 'root', role: null, superAdmin: true },
        ]) {
            mockedDeclare.mockClear()
            const { result } = run(annDb(), { userId: 'ann', birthYear: 2012 }, w)
            await expect(result).resolves.toMatchObject({ userId: 'ann', status: 'CONFIRMED' })
            expect(declared()).toMatchObject({ declaredById: w.invoker, confirmation: { confirmedById: w.invoker } })
        }
    })

    it('needs a booking through this club (404)', async () => {
        const none = run(makePrisma({ registrations: [] }))
        await expect(none.result).rejects.toBeInstanceOf(NotFoundError)
        const elsewhere = run(makePrisma({ registrations: [booking('stu', OTHER_W)] }))
        await expect(elsewhere.result).rejects.toBeInstanceOf(NotFoundError)
        const cancelled = run(makePrisma({ registrations: [booking('stu', W, 'CANCELLED')] }))
        await expect(cancelled.result).rejects.toBeInstanceOf(NotFoundError)
        expect(mockedDeclare).not.toHaveBeenCalled()
    })

    it('answers 404 for an event this club does not get', async () => {
        await expect(run(makePrisma({ event: null })).result).rejects.toBeInstanceOf(NotFoundError)
        await expect(run(makePrisma({ tournament: null })).result).rejects.toBeInstanceOf(NotFoundError)
    })

    it('refuses once weigh-in started or entries closed (409 TOURNAMENT_LOCKED)', async () => {
        const locked = { code: 'TOURNAMENT_LOCKED', statusCode: 409 }
        await expect(run(makePrisma({ tournament: tournamentRow('WEIGH_IN') })).result).rejects.toMatchObject(locked)
        await expect(run(makePrisma({ tournament: tournamentRow('RUNNING') })).result).rejects.toMatchObject(locked)
        const closed = tournamentRow('SETUP', { closes: new Date(Date.now() - 60_000) })
        await expect(run(makePrisma({ tournament: closed })).result).rejects.toMatchObject(locked)
        expect(mockedDeclare).not.toHaveBeenCalled()
    })

    it('needs the consent at the tournament edition (409 ORG_CONSENT_REQUIRED)', async () => {
        const old = [{ userId: 'stu', dependentId: null, version: OLD }]
        const self = run(makePrisma({ consents: old }))
        await expect(self.result).rejects.toBeInstanceOf(OrgConsentRequiredError)
        await expect(self.result).rejects.toMatchObject({ code: 'ORG_CONSENT_REQUIRED', statusCode: 409 })
        // A coach can't consent for the student.
        const byCoach = run(makePrisma({ consents: old }), { userId: 'stu' }, { invoker: 'coach', role: 'coach' })
        await expect(byCoach.result).rejects.toMatchObject({
            code: 'ORG_CONSENT_REQUIRED',
            message: 'Ученик должен обновить согласие в приложении',
        })
        // A guardian's record without a confirmed guardianship doesn't count.
        const unconfirmed = run(
            makePrisma({
                registrations: [booking('kid')],
                consents: [{ userId: 'parent', dependentId: 'kid', version: CURRENT }],
            }),
            {},
            { invoker: 'kid', guardianId: 'parent' },
        )
        await expect(unconfirmed.result).rejects.toBeInstanceOf(OrgConsentRequiredError)
        expect(mockedDeclare).not.toHaveBeenCalled()
    })
})

// ─── confirmTournamentEntry ──────────────────────────────────────────────

describe('confirmTournamentEntry', () => {
    const run = (prisma: FakePrisma, entryId: string, templateLevelId: string | undefined, w: Who = {}) => {
        const s = services()
        const handler = new ConfirmTournamentEntryHandler(
            prisma as never,
            new RbacService(prisma as never),
            s.audit as never,
            s.realtime as never,
        )
        return {
            ...s,
            result: handler.execute(
                new ConfirmTournamentEntryFeature(
                    templateLevelId ? { templateLevelId } : {},
                    W,
                    entryId,
                    w.invoker ?? 'coach',
                    roleOf(w, 'coach'),
                    w.superAdmin ?? false,
                ),
            ),
        }
    }
    const standardDb = () =>
        makePrisma({ divisions: STANDARD_DIVISIONS, levels: LEVELS, entries: [entry('stu'), entry('ann')] })
    const confirmed = () => mockedConfirm.mock.calls[0][1]

    it('takes the registry level and finds the division', async () => {
        mockedRegistry.mockResolvedValue(new Map([['stu', PURPLE]]))
        const prisma = standardDb()
        const { result, audit, realtime } = run(prisma, 'en-stu', undefined)
        await expect(result).resolves.toMatchObject({
            id: 'en-stu',
            status: 'CONFIRMED',
            divisionId: 'dHigh',
            divisionName: 'Фиолетовый+ до 77',
            levelName: 'Фиолетовый',
        })
        expect(confirmed()).toMatchObject({
            tournamentId: 't1',
            entryId: 'en-stu',
            confirmation: {
                confirmedById: 'coach',
                templateLevelId: 'lvl-purple',
                levelName: 'Фиолетовый',
                levelSetById: null,
                divisionId: 'dHigh',
            },
        })
        expect(mockedRegistry).toHaveBeenCalledWith(prisma, ORG, ['stu'])
        expect(prisma.organizationLadderTemplateLevel.findMany).not.toHaveBeenCalled()
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'tournament.entryConfirm',
                actorId: 'coach',
                metadata: expect.objectContaining({ divisionName: 'Фиолетовый+ до 77', levelFromRegistry: true }),
            }),
        )
        expect(realtime.invalidate).toHaveBeenCalledWith(W, ['organizations'])
    })

    it('takes the picked level without a registry belt, set by the coach', async () => {
        const prisma = standardDb()
        const { result, audit } = run(prisma, 'en-stu', 'lvl-blue')
        await expect(result).resolves.toMatchObject({ divisionId: 'dLow', levelName: 'Синий' })
        expect(confirmed().confirmation).toEqual({
            confirmedById: 'coach',
            templateLevelId: 'lvl-blue',
            levelName: 'Синий',
            levelSetById: 'coach',
            divisionId: 'dLow',
        })
        // Only a level of this org's standards.
        expect(prisma.organizationLadderTemplateLevel.findMany.mock.calls[0][0].where).toEqual({
            id: { in: ['lvl-blue'] },
            template: { organizationId: ORG },
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ metadata: expect.objectContaining({ levelFromRegistry: false }) }),
        )
    })

    it('needs a level when the registry has none (400 TOURNAMENT_LEVEL_REQUIRED), in the discipline words', async () => {
        const { result } = run(standardDb(), 'en-stu', undefined)
        await expect(result).rejects.toMatchObject({
            code: 'TOURNAMENT_LEVEL_REQUIRED',
            statusCode: 400,
            message: 'Укажите пояс по стандарту федерации',
        })
        const yoga = makePrisma({
            tournament: tournamentRow('SETUP', { orgType: 'YOGA' }),
            divisions: STANDARD_DIVISIONS,
            levels: LEVELS,
            entries: [entry('stu')],
        })
        await expect(run(yoga, 'en-stu', undefined).result).rejects.toMatchObject({
            code: 'TOURNAMENT_LEVEL_REQUIRED',
            message: 'Укажите уровень по стандарту федерации',
        })
        expect(mockedConfirm).not.toHaveBeenCalled()
    })

    it('answers 404 for a level outside the org standards, in the discipline words', async () => {
        const { result } = run(standardDb(), 'en-stu', 'lvl-foreign')
        await expect(result).rejects.toBeInstanceOf(NotFoundError)
        await expect(result).rejects.toMatchObject({ message: 'Пояс не найден в стандартах федерации' })
        const fitness = makePrisma({
            tournament: tournamentRow('SETUP', { orgType: 'FITNESS' }),
            divisions: STANDARD_DIVISIONS,
            levels: LEVELS,
            entries: [entry('stu')],
        })
        await expect(run(fitness, 'en-stu', 'lvl-foreign').result).rejects.toMatchObject({
            message: 'Уровень не найден в стандартах федерации',
        })
        expect(mockedConfirm).not.toHaveBeenCalled()
    })

    it('confirms without a level when no division uses a standard', async () => {
        const { result } = run(makePrisma({ entries: [entry('stu')] }), 'en-stu', undefined)
        await expect(result).resolves.toMatchObject({ status: 'CONFIRMED', divisionId: 'd77', levelName: null })
        expect(confirmed().confirmation).toMatchObject({ templateLevelId: null, divisionId: 'd77' })
    })

    it('refuses an athlete and a coach of another group (403)', async () => {
        const athlete = run(standardDb(), 'en-stu', 'lvl-blue', { invoker: 'stu', role: 'user' })
        await expect(athlete.result).rejects.toBeInstanceOf(ForbiddenError)
        const foreign = run(standardDb(), 'en-ann', 'lvl-blue')
        await expect(foreign.result).rejects.toBeInstanceOf(ForbiddenError)
        expect(mockedConfirm).not.toHaveBeenCalled()
    })

    it('answers 404 for an entry of another club and an unknown entry', async () => {
        const prisma = makePrisma({ entries: [entry('rival', { workspaceId: OTHER_W })] })
        await expect(run(prisma, 'en-rival', undefined, { invoker: 'adm', role: 'admin' }).result).rejects.toBeInstanceOf(
            NotFoundError,
        )
        expect(prisma.tournamentEntry.findFirst.mock.calls[0][0].where).toEqual({ id: 'en-rival', workspaceId: W })
        await expect(run(makePrisma(), 'en-none', undefined).result).rejects.toBeInstanceOf(NotFoundError)
        expect(mockedConfirm).not.toHaveBeenCalled()
    })

    it('answers 404 once the event no longer reaches this club (club left the org)', async () => {
        mockedRegistry.mockResolvedValue(new Map([['stu', PURPLE]]))
        const prisma = makePrisma({ divisions: STANDARD_DIVISIONS, levels: LEVELS, entries: [entry('stu')], event: null })
        const { result, audit } = run(prisma, 'en-stu', undefined)
        await expect(result).rejects.toBeInstanceOf(NotFoundError)
        // Looked up as the club's staff see it: this event, an ACTIVE link of this club.
        const where = prisma.organizationEvent.findFirst.mock.calls[0][0].where as {
            id: string
            OR: Array<{ audience: string; organization: { clubs: { some: object } } }>
        }
        expect(where.id).toBe('e1')
        expect(where.OR).toContainEqual({
            audience: 'STAFF',
            organization: { clubs: { some: { workspaceId: W, status: 'ACTIVE' } } },
        })
        expect(mockedConfirm).not.toHaveBeenCalled()
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('lets the owner (no member row), an admin and a super-admin confirm any student', async () => {
        for (const w of [
            { invoker: 'owner', role: null },
            { invoker: 'adm', role: 'admin' },
            { invoker: 'root', role: null, superAdmin: true },
        ]) {
            mockedConfirm.mockClear()
            const { result } = run(standardDb(), 'en-ann', 'lvl-white', w)
            await expect(result).resolves.toMatchObject({ userId: 'ann', status: 'CONFIRMED', divisionId: 'dLow' })
            expect(confirmed().confirmation).toMatchObject({ confirmedById: w.invoker, levelSetById: w.invoker })
        }
    })
})

// ─── listClubTournamentAthletes ──────────────────────────────────────────

describe('listClubTournamentAthletes', () => {
    const run = (prisma: FakePrisma, w: Who = {}) =>
        new ListClubTournamentAthletesHandler(prisma as never, new RbacService(prisma as never)).execute(
            new ListClubTournamentAthletesFeature(W, 'e1', w.invoker ?? 'coach', roleOf(w, 'coach'), w.superAdmin ?? false),
        )
    // Booked through this club: stu (coach's group, DECLARED), mate (coach's
    // group, nothing yet), ann (coach2's group, DECLARED), guest (in no
    // group). kid trains in the coach's group but isn't booked, left
    // cancelled: never a row.
    const clubDb = (o: Partial<Db> = {}) =>
        makePrisma({
            registrations: [
                booking('stu'),
                booking('mate'),
                booking('ann'),
                booking('guest'),
                booking('rival', OTHER_W),
                booking('left', W, 'CANCELLED'),
            ],
            groups: [
                { coachId: 'coach', studentIds: ['stu', 'mate', 'kid', 'left'] },
                { coachId: 'coach2', studentIds: ['ann'] },
            ],
            consents: [
                { userId: 'stu', dependentId: null, version: CURRENT },
                { userId: 'mate', dependentId: null, version: OLD },
            ],
            entries: [
                entry('stu', { weighedWeightG: null }),
                entry('ann', { sex: 'FEMALE', birthYear: 2012, declaredWeightG: 52000 }),
                entry('rival', { workspaceId: OTHER_W }),
            ],
            ...o,
        })

    it("lists a coach's booked own-group students with consent, registry level and entry", async () => {
        mockedRegistry.mockResolvedValue(new Map([['stu', PURPLE]]))
        const prisma = clubDb()
        const out = await run(prisma)
        expect(out.data).toEqual([
            {
                userId: 'stu',
                name: nameOf('stu'),
                registrationId: 'r-stu',
                consentCurrent: true,
                profileBirthYear: 2010,
                registryLevel: { templateLevelId: 'lvl-purple', name: 'Фиолетовый' },
                entry: expect.objectContaining({ id: 'en-stu', status: 'DECLARED', declaredWeightKg: 76.5, birthYear: 2010 }),
            },
            {
                userId: 'mate',
                name: nameOf('mate'),
                registrationId: 'r-mate',
                consentCurrent: false,
                profileBirthYear: 2011,
                registryLevel: null,
                entry: null,
            },
        ])
        expect(out.toConfirmCount).toBe(1)
        // Only live bookings of this club, then narrowed to the coach's write
        // scope (own groups' students).
        expect(prisma.organizationEventRegistration.findMany.mock.calls[0][0].where).toEqual({
            eventId: 'e1',
            workspaceId: W,
            status: 'BOOKED',
        })
        expect(prisma.groupMember.findMany).toHaveBeenCalledTimes(1)
        expect(prisma.groupMember.findMany.mock.calls[0][0].where).toEqual({
            group: { workspaceId: W, OR: [{ coaches: { some: { userId: 'coach' } } }, expect.anything()] },
        })
        // Entries of these people in this club only.
        expect(prisma.tournamentEntry.findMany.mock.calls[0][0].where).toMatchObject({
            tournamentId: 't1',
            workspaceId: W,
            userId: { in: ['stu', 'mate'] },
        })
    })

    it('lists everyone booked through the club for admin scope, never an unbooked student', async () => {
        for (const w of [
            { invoker: 'adm', role: 'admin' },
            { invoker: 'head', role: 'head_coach' },
            { invoker: 'owner', role: null },
            { invoker: 'root', role: null, superAdmin: true },
        ]) {
            const prisma = clubDb()
            const out = await run(prisma, w)
            expect(out.data.map((a) => a.userId).sort()).toEqual(['ann', 'guest', 'mate', 'stu'])
            expect(out.data.find((a) => a.userId === 'guest')).toMatchObject({ registrationId: 'r-guest', entry: null })
            expect(out.toConfirmCount).toBe(2)
            // Admin scope: no own-group narrowing at all.
            expect(prisma.groupMember.findMany).not.toHaveBeenCalled()
        }
    })

    it('gives a coach who sees all groups only their own booked students (write scope)', async () => {
        const out = await run(clubDb({ seesAll: true }))
        expect(out.data.map((a) => a.userId)).toEqual(['stu', 'mate'])
        // DECLARED among the listed entries: stu's, not ann's.
        expect(out.toConfirmCount).toBe(1)
    })

    it('gives a coach with no booked students an empty list', async () => {
        const out = await run(clubDb({ registrations: [booking('ann'), booking('guest')] }))
        expect(out).toEqual({ data: [], toConfirmCount: 0 })
    })

    it('shows weights, next match and places while the tournament runs', async () => {
        const out = await run(makePrisma({ ...runningDb(), registrations: [booking('stu'), booking('mate')] }))
        const mate = out.data.find((a) => a.userId === 'mate')
        expect(mate?.entry).toMatchObject({ weighedWeightKg: 75.1, bracketAvailable: true })
        expect(mate?.entry?.nextMatch).toEqual({
            mat: 1,
            ahead: 0,
            opponent: { hidden: false, personName: nameOf('rival'), clubName: 'Боевой дух', isMe: false, isMyClub: false },
            waitingFor: null,
        })
        expect(out.data.find((a) => a.userId === 'stu')?.entry?.nextMatch).toMatchObject({
            waitingFor: {
                entryA: expect.objectContaining({ personName: nameOf('rival') }),
                // Own club's coach always sees the own athlete's name.
                entryB: expect.objectContaining({ hidden: false, personName: nameOf('mate'), isMyClub: true }),
            },
        })
    })

    it('refuses a plain member (403)', async () => {
        await expect(run(clubDb(), { invoker: 'stu', role: 'user' })).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('answers 404 for an event this club does not get', async () => {
        await expect(run(clubDb({ event: null }))).rejects.toBeInstanceOf(NotFoundError)
        await expect(run(clubDb({ tournament: null }))).rejects.toBeInstanceOf(NotFoundError)
    })
})

// ─── getClubTournamentBracket ────────────────────────────────────────────

describe('getClubTournamentBracket', () => {
    const run = (prisma: FakePrisma, w: Who & { divisionId?: string } = {}) =>
        new GetClubTournamentBracketHandler(prisma as never).execute(
            new GetClubTournamentBracketFeature(W, 'e1', w.divisionId ?? 'd77', w.invoker ?? 'stu', roleOf(w, 'user')),
        )
    const USER_IDS = ['stu', 'mate', 'rival', 'ghost', 'left']

    it('carries no weight, birth year, sex or user id anywhere in the payload', async () => {
        const out = await run(makePrisma(runningDb()))
        const { keys, leaves } = scan(out)
        for (const k of keys) expect(k).not.toMatch(/weight|birth|sex|userId|level/i)
        for (const id of USER_IDS) expect(leaves).not.toContain(id)
        for (const n of [76200, 75100, 76900, 74300, 76500, 2009, 2010, 2011, 2012]) {
            expect(leaves).not.toContain(n)
        }
    })

    it("names people per consent and marks the viewer's own entry and club", async () => {
        const out = await run(makePrisma(runningDb()))
        expect(out).toMatchObject({
            division: { id: 'd77', name: 'Мужчины до 77 кг', mat: 1, drawnAt: DRAWN.toISOString(), finishedAt: null },
            size: 4,
            rounds: 2,
            soloWinner: null,
        })
        const [m1, m2, m3] = out.matches
        expect(m1).toEqual({
            id: 'm1',
            round: 1,
            position: 1,
            isBye: false,
            entryA: { hidden: false, personName: nameOf('stu'), clubName: 'ACADEMY', isMe: true, isMyClub: true },
            // An old consent edition: «Участник скрыт», no club.
            entryB: { hidden: true, personName: null, clubName: null, isMe: false, isMyClub: false },
            winnerSide: 'A',
            method: 'POINTS',
            scoreA: 4,
            scoreB: 0,
            decidedAt: '2026-12-20T05:00:00.000Z',
        })
        expect(m2.entryA).toEqual({ hidden: false, personName: nameOf('rival'), clubName: 'Боевой дух', isMe: false, isMyClub: false })
        // A teammate without the consent is hidden from a member too, without the club mark.
        expect(m2.entryB).toEqual({ hidden: true, personName: null, clubName: null, isMe: false, isMyClub: false })
        expect(m2.winnerSide).toBeNull()
        expect(m3.entryB).toBeNull()
    })

    it("hides a consenting athlete whose club left the org", async () => {
        const db = runningDb()
        db.entries = [...db.entries!.filter((e) => e.userId !== 'rival'), entry('left', { status: 'CONFIRMED', divisionId: 'd77', workspaceId: LEFT_W })]
        db.matches = db.matches!.map((m) => (m.id === 'm2' ? { ...m, entryAId: 'en-left' } : m))
        const out = await run(makePrisma(db))
        expect(out.matches[1].entryA).toEqual({ hidden: true, personName: null, clubName: null, isMe: false, isMyClub: false })
    })

    it("shows the club's staff and the owner their own athletes' names, never another club's hidden one", async () => {
        for (const w of [{ invoker: 'coach', role: 'coach' }, { invoker: 'owner', role: null }]) {
            const out = await run(makePrisma(runningDb()), w)
            expect(out.matches[1].entryB).toMatchObject({ hidden: false, personName: nameOf('mate'), isMyClub: true, isMe: false })
            expect(out.matches[0].entryB).toMatchObject({ hidden: true, personName: null })
        }
    })

    it('treats a super-admin without a club role as a member viewer', async () => {
        const out = await run(makePrisma(runningDb()), { invoker: 'root', role: null })
        expect(out.matches[1].entryB).toMatchObject({ hidden: true })
        expect(out.matches[0].entryA).toMatchObject({ isMe: false, isMyClub: true, hidden: false })
    })

    it('shows a finished bracket and a lone athlete', async () => {
        const db = runningDb('FINISHED')
        db.entries = [...db.entries!, entry('rival', { id: 'en-solo', divisionId: 'd85', workspaceId: OTHER_W, place: 1 })]
        const out = await run(makePrisma(db), { divisionId: 'd85' })
        expect(out).toMatchObject({ matches: [], size: 1, rounds: 0 })
        expect(out.soloWinner).toEqual({
            hidden: false,
            personName: nameOf('rival'),
            clubName: 'Боевой дух',
            isMe: false,
            isMyClub: false,
            place: 1,
        })
    })

    it('refuses before the tournament runs, an undrawn division and another tournament’s division (404)', async () => {
        for (const status of ['SETUP', 'WEIGH_IN'] as const) {
            const prisma = makePrisma({ ...runningDb(), tournament: tournamentRow(status) })
            await expect(run(prisma)).rejects.toBeInstanceOf(NotFoundError)
            expect(prisma.tournamentMatch.findMany).not.toHaveBeenCalled()
        }
        const undrawn = runningDb()
        undrawn.divisions = [division({ drawnAt: null })]
        await expect(run(makePrisma(undrawn))).rejects.toBeInstanceOf(NotFoundError)
        const foreign = runningDb()
        foreign.divisions = [...foreign.divisions!, division({ id: 'dX', tournamentId: 't2', drawnAt: DRAWN })]
        await expect(run(makePrisma(foreign), { divisionId: 'dX' })).rejects.toBeInstanceOf(NotFoundError)
    })

    it('answers 404 for an event this club does not get', async () => {
        await expect(run(makePrisma({ ...runningDb(), event: null }))).rejects.toBeInstanceOf(NotFoundError)
        await expect(run(makePrisma({ ...runningDb(), tournament: null }))).rejects.toBeInstanceOf(NotFoundError)
    })
})

// ─── getClubTournamentResults ────────────────────────────────────────────

describe('getClubTournamentResults', () => {
    const run = (prisma: FakePrisma, w: Who = {}) =>
        new GetClubTournamentResultsHandler(prisma as never).execute(
            new GetClubTournamentResultsFeature(W, 'e1', w.invoker ?? 'stu', roleOf(w, 'user')),
        )
    const finishedDb = () => {
        const db = runningDb('FINISHED')
        db.entries = db.entries!.map((e) =>
            e.userId === 'stu' ? { ...e, place: 1 } : e.userId === 'rival' ? { ...e, place: 2 } : e.userId === 'mate' ? { ...e, place: 3 } : e,
        )
        return db
    }

    it('lists podiums per division in place order, own club marked, names per consent', async () => {
        const out = await run(makePrisma(finishedDb()))
        expect(out.resultsPublishedAt).toBe(PUBLISHED.toISOString())
        // d85 has no placed entries: left out.
        expect(out.divisions).toHaveLength(1)
        expect(out.divisions[0]).toMatchObject({ divisionId: 'd77', name: 'Мужчины до 77 кг' })
        // Two thirds, both hidden from a member and unmarked (a hidden person
        // never carries the club mark): the teammate, then the other club's.
        expect(out.divisions[0].podium).toEqual([
            { hidden: false, personName: nameOf('stu'), clubName: 'ACADEMY', isMe: true, isMyClub: true, place: 1 },
            { hidden: false, personName: nameOf('rival'), clubName: 'Боевой дух', isMe: false, isMyClub: false, place: 2 },
            { hidden: true, personName: null, clubName: null, isMe: false, isMyClub: false, place: 3 },
            { hidden: true, personName: null, clubName: null, isMe: false, isMyClub: false, place: 3 },
        ])
        const { keys, leaves } = scan(out)
        for (const k of keys) expect(k).not.toMatch(/weight|birth|sex|userId/i)
        for (const id of ['stu', 'mate', 'rival', 'ghost']) expect(leaves).not.toContain(id)
    })

    it("shows the club's staff their own athlete's name", async () => {
        const out = await run(makePrisma(finishedDb()), { invoker: 'coach', role: 'coach' })
        expect(out.divisions[0].podium.find((p) => p.isMyClub && p.place === 3)).toMatchObject({
            hidden: false,
            personName: nameOf('mate'),
        })
    })

    it('answers 404 until the tournament is finished and its results published', async () => {
        for (const status of ['SETUP', 'WEIGH_IN', 'RUNNING'] as const) {
            await expect(run(makePrisma({ ...finishedDb(), tournament: tournamentRow(status) }))).rejects.toBeInstanceOf(
                NotFoundError,
            )
        }
        const unpublished = makePrisma({ ...finishedDb(), tournament: tournamentRow('FINISHED') })
        await expect(run(unpublished)).rejects.toBeInstanceOf(NotFoundError)
        expect(unpublished.tournamentEntry.findMany).not.toHaveBeenCalled()
    })

    it('answers 404 for an event this club does not get', async () => {
        await expect(run(makePrisma({ ...finishedDb(), event: null }))).rejects.toBeInstanceOf(NotFoundError)
    })
})
