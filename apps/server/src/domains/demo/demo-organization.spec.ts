import { localDateInTz } from '../../features/attendance/attendance-utils'
import { ORG_SHARING_CONSENT_VERSION } from '../organizations/consent'
import { LADDERS } from './demo-club.catalog'
import {
    buildDemoOrganizationRows,
    DEMO_ORG_ADULT_CONSENT_SHARE,
    DEMO_ORG_CHILD_CONSENT_SHARE,
    DEMO_ORG_ID,
    DEMO_ORG_KEY,
    DEMO_ORG_TEMPLATES,
    type DemoOrgClub,
    type DemoOrgPerson,
    demoOrgTemplateId,
    demoOrgTemplateLevelId,
    seedDemoOrganization,
} from './demo-organization'

const NOW = new Date('2026-11-04T09:30:00.000Z')
const DAY = 86_400_000
const TZ = 'Asia/Tomsk'
const ACADEMY: DemoOrgClub = { id: 'w-academy', name: 'ACADEMY', ownerId: 'u-owner-a', ownerEmail: 'owner@academy.demo', coachId: 'u-coach-a' }
const BERKUT: DemoOrgClub = { id: 'w-berkut', name: 'Беркут', ownerId: 'u-owner-b', ownerEmail: 'owner@berkut.demo', coachId: 'u-coach-b' }

// A population like the two demo clubs: adults and children (each with a
// confirmed guardian), most of them training the tournament's discipline.
const population = (club: DemoOrgClub, adults: number, kids: number): DemoOrgPerson[] => [
    ...Array.from({ length: adults }, (_, i) => ({
        userId: `${club.id}-a${i}`,
        workspaceId: club.id,
        guardianId: null,
        isChild: false,
        competes: i % 5 !== 0,
    })),
    ...Array.from({ length: kids }, (_, i) => ({
        userId: `${club.id}-k${i}`,
        workspaceId: club.id,
        guardianId: `${club.id}-p${i}`,
        isChild: true,
        competes: true,
    })),
]
const PEOPLE = [...population(ACADEMY, 220, 60), ...population(BERKUT, 64, 25)]
const build = (now: Date = NOW, people: readonly DemoOrgPerson[] = PEOPLE) =>
    buildDemoOrganizationRows({ now, federationUserId: 'u-fed', secretaryUserId: 'u-sec', clubs: { academy: ACADEMY, berkut: BERKUT }, people })

describe('buildDemoOrganizationRows', () => {
    const rows = build()

    it('is deterministic for the same day', () => {
        expect(JSON.stringify(build())).toBe(JSON.stringify(rows))
    })

    it('links ACADEMY without money and «Беркут» with its monthly income, on any reset day', () => {
        for (const days of [0, 9, 17, 26]) {
            const links = build(new Date(NOW.getTime() + days * DAY)).links
            expect(links.map((l) => [l.workspaceId, l.status, l.shareRegistry, l.shareMrr, l.shareRevenue30d])).toEqual([
                ['w-academy', 'ACTIVE', true, false, false],
                ['w-berkut', 'ACTIVE', true, true, false],
            ])
            expect(links.every((l) => l.organizationId === DEMO_ORG_ID && l.allowMemberEvents && l.allowMemberAnnouncements)).toBe(true)
            expect(links.every((l) => (l.decidedAt as Date) < new Date(NOW.getTime() + days * DAY))).toBe(true)
        }
    })

    it('links only the clubs that exist', () => {
        const only = buildDemoOrganizationRows({ now: NOW, federationUserId: 'u-fed', secretaryUserId: 'u-sec', clubs: { academy: ACADEMY, berkut: null }, people: PEOPLE })
        expect(only.links.map((l) => l.workspaceId)).toEqual(['w-academy'])
        expect(only.consents.every((c) => !String(c.dependentId ?? c.userId).startsWith('w-berkut'))).toBe(true)
        expect(only.registrations.every((r) => r.workspaceId === 'w-academy')).toBe(true)
    })

    it('has ~85% of adults and ~60% of children consenting, a child through the guardian', () => {
        const own = rows.consents.filter((c) => !c.dependentId)
        const forChild = rows.consents.filter((c) => c.dependentId)
        expect(own.length / 284).toBeCloseTo(DEMO_ORG_ADULT_CONSENT_SHARE, 1)
        expect(forChild.length / 85).toBeGreaterThan(DEMO_ORG_CHILD_CONSENT_SHARE - 0.12)
        expect(forChild.length / 85).toBeLessThan(DEMO_ORG_CHILD_CONSENT_SHARE + 0.12)
        expect(rows.consents.every((c) => c.kind === 'ORGANIZATION_SHARING' && c.organizationId === DEMO_ORG_ID && c.version === ORG_SHARING_CONSENT_VERSION)).toBe(true)
        for (const c of forChild) expect(c.userId).toBe(String(c.dependentId).replace('-k', '-p'))
        expect(rows.consents.every((c) => (c.acceptedAt as Date) < NOW)).toBe(true)
    })

    it('never consents for a child without a confirmed guardian, and keeps the script\'s decisions', () => {
        const people: DemoOrgPerson[] = [
            { userId: 'orphan', workspaceId: 'w-academy', guardianId: null, isChild: true, competes: true },
            { userId: 'student', workspaceId: 'w-academy', guardianId: null, isChild: false, competes: true, consent: true },
            { userId: 'parent', workspaceId: 'w-academy', guardianId: null, isChild: false, competes: true, consent: false },
            { userId: 'misha', workspaceId: 'w-academy', guardianId: 'parent', isChild: true, competes: true, consent: true },
            { userId: 'anya', workspaceId: 'w-academy', guardianId: 'parent', isChild: true, competes: true, consent: false },
        ]
        const r = build(NOW, people)
        expect(r.consents.map((c) => [c.userId, c.dependentId ?? null])).toEqual([
            ['student', null],
            ['parent', 'misha'],
        ])
        // The people of the script register live, never by the seed.
        expect(r.registrations).toEqual([])
    })

    it('puts the tournament in 24 days with 23 registrations from both clubs, consenting competitors only', () => {
        const today = localDateInTz(NOW, TZ)
        const t = rows.events.find((e) => e.kind === 'COMPETITION')!
        expect(t).toMatchObject({ title: 'Открытый турнир Томской области', capacity: 200, hostWorkspaceId: 'w-academy', feeNote: 'Взнос 1 500 ₽ на месте', audience: 'STAFF_AND_MEMBERS' })
        expect(Math.round((Date.parse(localDateInTz(t.startAt as Date, TZ)) - Date.parse(today)) / DAY)).toBe(24)
        expect(rows.registrations).toHaveLength(23)
        expect(rows.registrations.filter((r) => r.workspaceId === 'w-academy')).toHaveLength(14)
        expect(rows.registrations.filter((r) => r.workspaceId === 'w-berkut')).toHaveLength(9)
        const consented = new Set(rows.consents.map((c) => c.dependentId ?? c.userId))
        const competes = new Set(PEOPLE.filter((p) => p.competes).map((p) => p.userId))
        for (const r of rows.registrations) {
            expect(r).toMatchObject({ eventId: t.id, status: 'BOOKED' })
            expect(consented.has(r.userId)).toBe(true)
            expect(competes.has(r.userId)).toBe(true)
            expect((r.createdAt as Date) < NOW).toBe(true)
        }
        const by = new Set(rows.registrations.map((r) => r.bookedById))
        expect(by.has('u-coach-a') || by.has('u-coach-b')).toBe(true)
        expect(rows.registrations.some((r) => r.bookedById === r.userId)).toBe(true)
    })

    it('has a coaches\' seminar, a grading day and the two cup stages, all published', () => {
        expect(rows.events.map((e) => [e.kind, e.audience, e.title])).toEqual([
            ['COMPETITION', 'STAFF_AND_MEMBERS', 'Открытый турнир Томской области'],
            ['SEMINAR', 'STAFF', expect.any(String)],
            ['GRADING', 'STAFF_AND_MEMBERS', expect.any(String)],
            ['COMPETITION', 'STAFF_AND_MEMBERS', 'Кубок федерации, 1-й этап'],
            ['COMPETITION', 'STAFF_AND_MEMBERS', 'Кубок федерации, 2-й этап'],
        ])
        const grading = rows.events.find((e) => e.kind === 'GRADING')!
        expect(Math.round(((grading.startAt as Date).getTime() - NOW.getTime()) / DAY)).toBeGreaterThanOrEqual(44)
        expect(rows.events.every((e) => (e.publishedAt as Date) < NOW && e.timezone === TZ)).toBe(true)
    })

    it('has two announcements, already delivered to the clubs\' staff', () => {
        expect(rows.announcements.map((a) => [a.title, a.audience])).toEqual([
            ['Положение о турнире опубликовано', 'STAFF_AND_MEMBERS'],
            [expect.stringMatching(/^Собрание тренеров \d+ [а-я]+$/), 'STAFF'],
        ])
        expect(rows.announcements.every((a) => a.staffNotifiedAt === a.publishedAt && (a.publishedAt as Date) < NOW)).toBe(true)
    })

    it('publishes the two standards: adults at version 2, children at version 1', () => {
        expect(rows.templates.map((t) => [t.id, t.name, t.version])).toEqual([
            [demoOrgTemplateId('adults'), 'Пояса (взрослые)', 2],
            [demoOrgTemplateId('kids'), 'Пояса (дети)', 1],
        ])
        expect(rows.templateLevels.filter((l) => l.templateId === demoOrgTemplateId('adults')).map((l) => l.name)).toEqual([
            'Белый',
            'Синий',
            'Фиолетовый',
            'Коричневый',
            'Чёрный',
        ])
        expect(rows.templateLevels[0].id).toBe(demoOrgTemplateLevelId('adults', 0))
    })

    it('writes the org side of the audit trail, with the clubs\' own decisions', () => {
        expect(rows.auditEvents.every((e) => e.organizationId === DEMO_ORG_ID && /^(org|tournament)\./.test(e.action))).toBe(true)
        expect(rows.auditEvents.filter((e) => e.action === 'org.acceptInvite').map((e) => [e.workspaceId, e.actorId])).toEqual([
            ['w-berkut', 'u-owner-b'],
            ['w-academy', 'u-owner-a'],
        ])
        expect(rows.auditEvents.filter((e) => e.action === 'org.inviteClub').every((e) => e.workspaceId === null && e.actorId === 'u-fed')).toBe(true)
        // The live metadata shapes, so the journals label the rows.
        expect(rows.auditEvents.find((e) => e.action === 'org.acceptInvite' && e.workspaceId === 'w-academy')!.metadata).toEqual({
            organizationName: 'Федерация БЖЖ Томской области',
            clubName: 'ACADEMY',
            sharing: { shareRegistry: true, shareMrr: false, shareRevenue30d: false, allowMemberAnnouncements: true, allowMemberEvents: true },
        })
        expect(rows.auditEvents.filter((e) => e.action === 'org.updateSharing').map((e) => [e.workspaceId, e.metadata])).toEqual([
            ['w-berkut', { organizationName: 'Федерация БЖЖ Томской области', clubName: 'Беркут', changes: { shareMrr: true } }],
        ])
    })
})

// A transaction mock: every model method a jest.fn with a neutral answer.
const METHODS = ['findUnique', 'findFirst', 'findMany', 'create', 'update', 'delete', 'createMany', 'updateMany', 'deleteMany'] as const
type ModelMock = Record<(typeof METHODS)[number], jest.Mock>
const model = (overrides: Partial<ModelMock> = {}): ModelMock => {
    const m = {} as ModelMock
    for (const method of METHODS) {
        m[method] =
            overrides[method] ??
            jest.fn().mockImplementation(async () => {
                if (method === 'findMany') return []
                if (method.endsWith('Many')) return { count: 0 }
                if (method === 'create' || method === 'update') return { id: DEMO_ORG_ID }
                return null
            })
    }
    return m
}
const MODELS = [
    'workspace',
    'organizationMember',
    'workspaceMember',
    'guardianship',
    'rankPromotion',
    'rankLadder',
    'rankLevel',
    'organizationClub',
    'organizationLadderTemplate',
    'organizationLadderTemplateLevel',
    'organizationEvent',
    'organizationEventRegistration',
    'organizationAnnouncement',
    'consentRecord',
    'auditEvent',
    'tournament',
    'tournamentDivision',
    'tournamentEntry',
    'tournamentMatch',
    'notificationDispatchLog',
] as const
type Account = { id: string; isDemo: boolean } | null
// The two staff addresses: the president's (`account`) and the secretary's
// (`secretary`, by default a demo one whenever the president's exists).
const txMock = (o: { org?: { id: string; isDemo: boolean } | null; account?: Account; secretary?: Account } = {}) => ({
    organization: model({ findUnique: jest.fn().mockResolvedValue(o.org ?? null) }),
    user: model({
        findUnique: jest.fn().mockImplementation(async ({ where }: { where: { email?: string } }) =>
            where.email === 'federation@academy.demo'
                ? (o.account ?? null)
                : where.email === 'secretary@academy.demo'
                  ? o.secretary !== undefined
                      ? o.secretary
                      : o.account
                        ? { id: 'u-sec', isDemo: true }
                        : null
                  : null,
        ),
    }),
    ...(Object.fromEntries(MODELS.map((name) => [name, model()])) as Record<(typeof MODELS)[number], ModelMock>),
})
const writes = (tx: Record<string, ModelMock>) =>
    Object.values(tx).flatMap((m) =>
        (['create', 'update', 'delete', 'createMany', 'updateMany', 'deleteMany'] as const).flatMap((k) => m[k].mock.calls),
    )
const INPUT = { now: NOW, personalDataConsentVersion: '2026-11-01' }

describe('seedDemoOrganization', () => {
    it('never touches a real organization at the demo key', async () => {
        const tx = txMock({ org: { id: 'o-real', isDemo: false } })
        await expect(seedDemoOrganization(tx as never, INPUT)).resolves.toBe('blocked')
        expect(writes(tx)).toEqual([])
        expect(tx.user.findUnique).not.toHaveBeenCalled()
    })

    it('never takes over the address of a real account', async () => {
        const tx = txMock({ account: { id: 'u-real', isDemo: false } })
        await expect(seedDemoOrganization(tx as never, INPUT)).resolves.toBe('blocked')
        expect(writes(tx)).toEqual([])
    })

    it('never takes over the address of a real account at the secretary\'s address either', async () => {
        const tx = txMock({ account: { id: 'u-fed', isDemo: true }, secretary: { id: 'u-real', isDemo: false } })
        await expect(seedDemoOrganization(tx as never, INPUT)).resolves.toBe('blocked')
        expect(writes(tx)).toEqual([])
    })

    it('creates the federation with its administrator, then replaces every scripted row', async () => {
        const tx = txMock()
        await expect(seedDemoOrganization(tx as never, INPUT)).resolves.toBe('seeded')
        expect(tx.organization.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ id: DEMO_ORG_ID, key: DEMO_ORG_KEY, isDemo: true, type: 'GRAPPLING', timezone: TZ }),
            select: { id: true },
        })
        expect(tx.user.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ email: 'federation@academy.demo', isDemo: true, firstname: 'Николай', lastname: 'Белов' }),
        })
        expect(tx.user.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ email: 'secretary@academy.demo', isDemo: true, firstname: 'Ирина', lastname: 'Ковалёва' }),
        })
        // The president administers, the tournament secretary is an org coach.
        expect(tx.organizationMember.createMany).toHaveBeenCalledWith({
            data: [
                expect.objectContaining({ organizationId: DEMO_ORG_ID, role: 'ORG_ADMIN' }),
                expect.objectContaining({ organizationId: DEMO_ORG_ID, role: 'ORG_COACH' }),
            ],
        })
        expect(tx.consentRecord.create).toHaveBeenCalledTimes(2)
        expect(tx.consentRecord.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ kind: 'PERSONAL_DATA', version: '2026-11-01' }),
        })
        // Old rows go before the new ones are written; the club's own audit
        // rows about the federation (a copied ladder) stay.
        for (const m of ['organizationClub', 'organizationLadderTemplate', 'organizationEvent', 'organizationAnnouncement', 'consentRecord'] as const) {
            expect(tx[m].deleteMany.mock.invocationCallOrder[0]).toBeLessThan(tx[m].createMany.mock.invocationCallOrder[0])
        }
        expect(tx.auditEvent.deleteMany).toHaveBeenCalledWith({
            where: { organizationId: DEMO_ORG_ID, OR: [{ action: { startsWith: 'org.' } }, { action: { startsWith: 'tournament.' } }] },
        })
        // No demo club yet: no links, no people; the tournaments still go in
        // after their events, the past pushes marked sent.
        expect(tx.organizationClub.createMany).toHaveBeenCalledWith({ data: [] })
        expect(tx.organizationEvent.createMany.mock.invocationCallOrder[0]).toBeLessThan(tx.tournament.createMany.mock.invocationCallOrder[0])
        expect(tx.tournament.createMany.mock.calls[0][0].data.map((t: { status: string }) => t.status)).toEqual(['FINISHED', 'RUNNING', 'SETUP'])
        for (const [a, b] of [['tournament', 'tournamentDivision'], ['tournamentDivision', 'tournamentEntry'], ['tournamentEntry', 'tournamentMatch']] as const) {
            expect(tx[a].createMany.mock.invocationCallOrder[0]).toBeLessThan(tx[b].createMany.mock.invocationCallOrder[0])
        }
        expect(tx.notificationDispatchLog.createMany).toHaveBeenCalledWith({ data: expect.any(Array), skipDuplicates: true })
    })

    it('is the same on a second run: the existing demo federation is updated, not duplicated', async () => {
        const account = { id: 'u-fed', isDemo: true }
        const first = txMock({ account })
        await seedDemoOrganization(first as never, INPUT)
        const second = txMock({ org: { id: DEMO_ORG_ID, isDemo: true }, account })
        await seedDemoOrganization(second as never, INPUT)
        expect(second.organization.create).not.toHaveBeenCalled()
        expect(second.user.create).not.toHaveBeenCalled()
        expect(second.organization.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: DEMO_ORG_ID } }))
        for (const m of ['organizationEvent', 'organizationAnnouncement', 'organizationLadderTemplate', 'auditEvent', 'tournament', 'tournamentDivision'] as const) {
            expect(JSON.stringify(second[m].createMany.mock.calls)).toBe(JSON.stringify(first[m].createMany.mock.calls))
        }
    })

    it('links ACADEMY\'s adults\' and children\'s BJJ ladders to the two standards, level by level', async () => {
        const tx = txMock({ account: { id: 'u-fed', isDemo: true } })
        tx.workspace.findFirst.mockImplementation(async ({ where }: { where: { key: string } }) =>
            where.key === 'academy-demo' ? { id: 'w-academy', key: 'academy-demo', name: 'ACADEMY', createdAt: NOW } : null,
        )
        tx.workspace.findUnique.mockResolvedValue({ ownerId: 'u-owner-a' })
        tx.rankLadder.updateMany.mockResolvedValue({ count: 1 })
        await expect(seedDemoOrganization(tx as never, INPUT)).resolves.toBe('seeded')

        expect(tx.rankLadder.updateMany.mock.calls.map(([arg]) => arg)).toEqual([
            { where: { id: expect.any(String), workspaceId: 'w-academy' }, data: { templateId: demoOrgTemplateId('adults'), templateVersion: 1 } },
            { where: { id: expect.any(String), workspaceId: 'w-academy' }, data: { templateId: demoOrgTemplateId('kids'), templateVersion: 1 } },
        ])
        const [adultsLadder, kidsLadder] = tx.rankLadder.updateMany.mock.calls.map(([arg]) => arg.where.id as string)
        expect(adultsLadder).not.toBe(kidsLadder)
        const levels = tx.rankLevel.updateMany.mock.calls.map(([arg]) => [arg.where.ladderId, arg.where.order, arg.data.templateLevelId])
        expect(levels).toEqual([
            ...[0, 1, 2, 3, 4].map((order) => [adultsLadder, order, demoOrgTemplateLevelId('adults', order)]),
            ...[0, 1, 2, 3, 4].map((order) => [kidsLadder, order, demoOrgTemplateLevelId('kids', order)]),
        ])
        // Linked by order: ACADEMY's level names are the standards' ones.
        for (const [ladder, template] of [['bjj', 'adults'], ['bjjKids', 'kids']] as const) {
            expect(LADDERS.find((l) => l.key === ladder)!.levels.map((l) => l.name)).toEqual(
                DEMO_ORG_TEMPLATES.find((t) => t.key === template)!.levels.map((l) => l.name),
            )
        }
    })
})
