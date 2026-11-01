import { ClubImportEngine } from './club-import.engine'
import type { ClubImportRowResult, ClubImportSummary } from './schemas'

const NOW = new Date('2026-11-01T09:00:00Z')

const HEADERS = ['ФИО', 'E-mail', 'Телефон', 'Дата рождения', 'E-mail родителя', 'Зал', 'Направление', 'Группа', 'Пояс', 'Полоски', 'Абонемент', 'Дата начала', 'Дата окончания', 'Осталось', 'Оплачено', 'Заметки']
const MAPPING = Object.fromEntries(
    ['fullName', 'email', 'phone', 'dateOfBirth', 'parentEmail', 'gym', 'direction', 'group', 'rank', 'stripes', 'plan', 'startDate', 'endDate', 'classesLeft', 'paid', 'notes'].map((k, i) => [k, i]),
)

type Row = Partial<Record<'name' | 'email' | 'phone' | 'dob' | 'parent' | 'gym' | 'dir' | 'group' | 'rank' | 'stripes' | 'plan' | 'start' | 'end' | 'left' | 'paid' | 'notes', string>>
const cells = (r: Row) => [r.name, r.email, r.phone, r.dob, r.parent, r.gym, r.dir, r.group, r.rank, r.stripes, r.plan, r.start, r.end, r.left, r.paid, r.notes].map((v) => v ?? '')

type User = { id: string; email: string | null; status: string; firstname: string | null; lastname: string | null; dateOfBirth: Date | null; phone: string | null }

// An in-memory stand-in for the slice of Prisma the engine touches: a club
// with one gym, БЖЖ, the group «Взрослые», a 12-class tariff and a ladder.
const makeWorld = (opts: { rows: Row[]; createMissing?: boolean; overwrite?: boolean; users?: User[]; members?: Record<string, unknown>[] }) => {
    let seq = 0
    const id = (p: string) => `${p}-${++seq}`
    const users: User[] = [...(opts.users ?? [])]
    const members: Array<Record<string, unknown>> = [...(opts.members ?? [])]
    const job = {
        id: 'imp1',
        workspaceId: 'w1',
        createdById: 'admin',
        createMissing: opts.createMissing ?? false,
        overwrite: opts.overwrite ?? false,
        fileName: 'club.csv',
        headers: HEADERS,
        rows: opts.rows.map(cells),
        mapping: MAPPING,
    }
    const saved: Record<string, unknown> = {}
    const findUser = (where: { email?: string; phone?: string }) =>
        users.find((u) => (where.email ? u.email === where.email : u.phone === where.phone)) ?? null
    const prisma = {
        clubImport: {
            findUnique: jest.fn().mockResolvedValue(job),
            update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(saved, data)),
        },
        workspace: {
            findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'w1', name: 'Клуб', ownerId: 'owner', timezone: 'Europe/Moscow' }),
            count: jest.fn().mockResolvedValue(0),
        },
        role: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'role-user' }) },
        gym: {
            findMany: jest.fn().mockResolvedValue([{ id: 'gym1', name: 'Центральный' }]),
            create: jest.fn(async ({ data }: { data: { name: string } }) => ({ id: id('gym'), name: data.name })),
        },
        direction: {
            findMany: jest.fn().mockResolvedValue([{ id: 'bjj', name: 'БЖЖ' }]),
            create: jest.fn(async ({ data }: { data: { name: string } }) => ({ id: id('dir'), name: data.name })),
        },
        group: {
            findMany: jest.fn().mockResolvedValue([{ id: 'adults', name: 'Взрослые', gymId: 'gym1', directionId: 'bjj', coachId: 'admin' }]),
            create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: id('group'), ...data })),
        },
        groupCoach: { create: jest.fn().mockResolvedValue({}) },
        plan: {
            findMany: jest.fn().mockResolvedValue([{ id: 'p12', name: '12 занятий', directionId: null, price: 500000, currency: 'RUB', durationDays: 30, classCount: 12, isActive: true }]),
            create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: id('plan'), ...data })),
        },
        rankLadder: {
            findMany: jest.fn().mockResolvedValue([{ id: 'lad', name: 'Пояса', directionId: 'bjj', audience: null, levels: [{ id: 'blue', name: 'Синий', order: 1, maxStripes: 4, isActive: true }] }]),
            create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: id('ladder'), name: data.name, directionId: data.directionId, audience: null })),
        },
        rankLevel: {
            create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: id('level'), isActive: true, ...data })),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        user: {
            findUnique: jest.fn(async ({ where }: { where: { email?: string; phone?: string } }) => findUser(where)),
            findFirst: jest.fn(async ({ where }: { where: { phone: string } }) =>
                users.find((u) => u.phone === where.phone && members.some((m) => m.userId === u.id)) ?? null,
            ),
            findMany: jest.fn(async ({ where }: { where: { firstname: { equals: string } } }) =>
                users.filter((u) => u.firstname === where.firstname.equals && members.some((m) => m.userId === u.id)),
            ),
            create: jest.fn(async ({ data }: { data: Omit<User, 'id'> }) => {
                const u = { id: id('user'), ...data } as User
                users.push(u)
                return { id: u.id }
            }),
            upsert: jest.fn(async ({ where, create }: { where: { email: string }; create: Omit<User, 'id'> }) => {
                const found = findUser(where)
                if (found) return { id: found.id }
                const u = { id: id('parent'), ...create } as User
                users.push(u)
                return { id: u.id }
            }),
            update: jest.fn().mockResolvedValue({}),
        },
        workspaceMember: {
            findUnique: jest.fn(async ({ where }: { where: { userId_workspaceId: { userId: string } } }) =>
                members.find((m) => m.userId === where.userId_workspaceId.userId) ?? null,
            ),
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
                const m = { id: id('member'), ...data }
                members.push(m)
                return { id: m.id }
            }),
            update: jest.fn().mockResolvedValue({}),
            findUniqueOrThrow: jest.fn().mockResolvedValue({ accessUntil: null }),
        },
        workspaceInvitation: { findUnique: jest.fn().mockResolvedValue(null) },
        groupMember: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn().mockResolvedValue({}) },
        dropInBooking: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        rankPromotion: { findMany: jest.fn().mockResolvedValue([]) },
        subscription: {
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn(async () => ({ id: id('sub') })),
        },
        guardianship: {
            findMany: jest.fn().mockResolvedValue([]),
            upsert: jest.fn(async () => ({ id: id('link') })),
        },
        $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    }
    const deps = {
        ranks: { promoteInTx: jest.fn().mockResolvedValue({}) },
        invitations: { invite: jest.fn().mockResolvedValue({ invitationId: 'inv', emailSent: false }) },
        notifications: { notifyUser: jest.fn().mockResolvedValue(true) },
        audit: { record: jest.fn().mockResolvedValue(undefined) },
        realtime: { invalidate: jest.fn(), joinWorkspaceRoom: jest.fn() },
    }
    const engine = new ClubImportEngine(
        prisma as never,
        deps.ranks as never,
        deps.invitations as never,
        deps.notifications as never,
        deps.audit as never,
        deps.realtime as never,
    )
    return {
        prisma,
        deps,
        users,
        // Every write the dry run must never make.
        writes: [
            prisma.user.create,
            prisma.user.upsert,
            prisma.user.update,
            prisma.workspaceMember.create,
            prisma.workspaceMember.update,
            prisma.subscription.create,
            prisma.groupMember.upsert,
            prisma.guardianship.upsert,
            prisma.gym.create,
            prisma.direction.create,
            prisma.group.create,
            prisma.plan.create,
            prisma.rankLadder.create,
            prisma.rankLevel.create,
        ],
        run: async (mode: 'preview' | 'apply') => {
            await engine.run('imp1', mode, NOW)
            return {
                summary: saved.summary as ClubImportSummary,
                results: saved.rowResults as ClubImportRowResult[],
                missing: saved.missing,
                status: saved.status,
            }
        },
    }
}

const ivan: Row = { name: 'Иванов Иван', email: 'ivan@example.com', phone: '89001112233', dob: '15.04.1990', gym: 'Центральный', dir: 'БЖЖ', group: 'Взрослые', rank: 'Синий', stripes: '2', plan: '12 занятий', start: '25.10.2026', end: '24.11.2026', left: '7', paid: 'да', notes: 'колено' }

describe('ClubImportEngine', () => {
    it('previews without writing: new adult, child, invitation, owner, no e-mail, bad row', async () => {
        const world = makeWorld({
            rows: [
                ivan,
                { name: 'Петрова Маша', dob: '03.09.2016', parent: 'mama@example.com', group: 'Взрослые', plan: '12 занятий', paid: 'нет' },
                { name: 'Знакомый', email: 'known@example.com', group: 'Взрослые', plan: '12 занятий' },
                { name: 'Владелец', email: 'owner@example.com' },
                { name: 'Без Почты' },
                { name: 'Плохая Дата', email: 'x@example.com', dob: '31.02.2000' },
                { name: 'Петрова Маша', dob: '03.09.2016', parent: 'mama@example.com', group: 'Дети' },
            ],
            users: [
                { id: 'known', email: 'known@example.com', status: 'ACTIVE', firstname: 'Пётр', lastname: null, dateOfBirth: null, phone: null },
                { id: 'owner', email: 'owner@example.com', status: 'ACTIVE', firstname: null, lastname: null, dateOfBirth: null, phone: null },
            ],
        })
        const { summary, results, missing, status } = await world.run('preview')

        expect(status).toBe('PREVIEWED')
        expect(summary).toMatchObject({ rows: 7, create: 2, invite: 1, skip: 3, error: 1, children: 1, groupMemberships: 2, subscriptions: 2, ranks: 1 })
        expect(results[0]).toMatchObject({ line: 2, action: 'create' })
        expect(results[0].changes).toEqual([
            'новый участник',
            'группа «Взрослые»',
            'пояс «Синий», 2 пол.',
            'абонемент «12 занятий» 25.10.2026–24.11.2026, осталось 7',
            'заметки',
        ])
        expect(results[1].changes).toContain('родитель mama@example.com (подтвердит в приложении)')
        expect(results[2]).toMatchObject({ action: 'invite' })
        expect(results[2].messages[0]).toContain('абонемент')
        expect(results[3].messages).toEqual(['Это владелец клуба — пропущен'])
        expect(results[4].messages[0]).toContain('Нет e-mail')
        expect(results[5]).toMatchObject({ action: 'error', messages: ['Дата рождения: «31.02.2000» — нужна дата вида 31.12.2025'] })
        expect(results[6].messages[0]).toContain('Группа «Дети»')
        expect(missing).toMatchObject({ groups: ['Группа «Дети»'] })

        for (const write of world.writes) expect(write).not.toHaveBeenCalled()
        expect(world.deps.invitations.invite).not.toHaveBeenCalled()
        expect(world.deps.audit.record).not.toHaveBeenCalled()
    })

    it('applies: creates people, missing entities, abonements and ranks, and audits the counts', async () => {
        const world = makeWorld({
            createMissing: true,
            rows: [
                { ...ivan, gym: 'Южный', dir: 'ММА', group: 'ММА вечер', plan: 'Безлимит', rank: 'Жёлтый', stripes: '1' },
                { name: 'Иванов Иван', email: 'ivan@example.com', group: 'Взрослые' },
                { name: 'Петрова Маша', dob: '03.09.2016', parent: 'mama@example.com', group: 'Взрослые' },
                { name: 'Знакомый', email: 'known@example.com', group: 'Взрослые' },
            ],
            users: [{ id: 'known', email: 'known@example.com', status: 'ACTIVE', firstname: 'Пётр', lastname: null, dateOfBirth: null, phone: null }],
        })
        const { summary, results, status } = await world.run('apply')
        const { prisma, deps } = world

        expect(status).toBe('APPLIED')
        expect(results.map((r) => r.action)).toEqual(['create', 'update', 'create', 'invite'])
        expect(summary).toMatchObject({ createdGyms: 1, createdDirections: 1, createdGroups: 1, createdPlans: 1, createdRanks: 1, groupMemberships: 3 })

        expect(prisma.gym.create.mock.calls[0][0].data).toEqual({ workspaceId: 'w1', name: 'Южный', address: '' })
        expect(prisma.group.create.mock.calls[0][0].data).toMatchObject({ name: 'ММА вечер', coachId: 'admin' })
        expect(prisma.plan.create.mock.calls[0][0].data).toMatchObject({ name: 'Безлимит', price: 0, currency: 'RUB', durationDays: 30 })
        expect(prisma.rankLadder.create.mock.calls[0][0].data).toMatchObject({ name: 'Пояса · ММА' })
        expect(prisma.rankLevel.create.mock.calls[0][0].data).toMatchObject({ name: 'Жёлтый', order: 0, maxStripes: 1 })

        expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({
            email: 'ivan@example.com',
            firstname: 'Иван',
            lastname: 'Иванов',
            phone: '+79001112233',
            dateOfBirth: new Date('1990-04-15T00:00:00.000Z'),
        })
        const sub = prisma.subscription.create.mock.calls[0][0].data
        expect(sub).toMatchObject({ status: 'ACTIVE', isPaid: true, amountPaid: 0, classesTotal: 7, classesRemaining: 7, source: 'MANUAL' })
        expect(sub.startDate).toEqual(new Date('2026-10-24T21:00:00.000Z'))
        expect(sub.endDate).toEqual(new Date('2026-11-23T21:00:00.000Z'))
        const subId = (await prisma.subscription.create.mock.results[0].value).id
        expect(prisma.workspaceMember.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { subscriptionId: subId, accessUntil: sub.endDate } }),
        )
        expect(deps.ranks.promoteInTx.mock.calls[0][1]).toMatchObject({ stripes: 1, awardedById: 'admin', note: 'Импорт' })

        // The child and a brand-new parent account, linked pending consent.
        expect(prisma.user.create.mock.calls[1][0].data).toMatchObject({ email: null, firstname: 'Маша' })
        expect(prisma.user.upsert.mock.calls[0][0].where).toEqual({ email: 'mama@example.com' })
        expect(prisma.guardianship.upsert.mock.calls[0][0].create).toMatchObject({ relation: 'PARENT', invitedByWorkspaceId: 'w1' })
        expect(deps.notifications.notifyUser).not.toHaveBeenCalled()

        expect(deps.invitations.invite).toHaveBeenCalledWith(
            expect.objectContaining({ user: { id: 'known', email: 'known@example.com' }, groupId: 'adults', sendEmail: false }),
        )
        expect(deps.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'club.import', metadata: expect.objectContaining({ create: 2, update: 1, invite: 1 }) }))
        expect(deps.realtime.joinWorkspaceRoom).toHaveBeenCalledWith(expect.arrayContaining([expect.any(String)]), 'w1')
    })

    it('fills only empty fields of an existing member unless overwrite is on', async () => {
        const existing: User = { id: 'm1', email: 'ivan@example.com', status: 'ACTIVE', firstname: 'Ваня', lastname: null, dateOfBirth: null, phone: null }
        const member = { id: 'wm1', userId: 'm1', status: 'ACTIVE', notes: 'старые', subscription: { status: 'ACTIVE', endDate: new Date('2026-12-01T00:00:00Z'), plan: { name: 'Безлимит' } } }
        const world = makeWorld({ rows: [ivan], users: [existing], members: [member] })
        world.prisma.rankPromotion.findMany.mockResolvedValue([{ ladderId: 'lad', levelId: 'white', stripes: 0 }])

        const { results } = await world.run('apply')
        expect(results[0].action).toBe('update')
        expect(results[0].changes).toEqual(['фамилия', 'дата рождения', 'телефон', 'группа «Взрослые»'])
        expect(results[0].messages).toEqual([
            'Имя не изменено (в клубе «Ваня»; включите «Перезаписать»)',
            'Пояс не изменён: в клубе уже указан другой (включите «Перезаписать»)',
            'Абонемент «12 занятий» не добавлен: у участника уже есть действующий «Безлимит»',
            'Заметки не изменены: в клубе уже есть другие (включите «Перезаписать»)',
        ])
        expect(world.prisma.user.update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { lastname: 'Иванов', dateOfBirth: new Date('1990-04-15T00:00:00.000Z'), phone: '+79001112233' },
        })
        expect(world.prisma.subscription.create).not.toHaveBeenCalled()

        const over = makeWorld({ rows: [ivan], users: [{ ...existing }], members: [member], overwrite: true })
        over.prisma.rankPromotion.findMany.mockResolvedValue([{ ladderId: 'lad', levelId: 'white', stripes: 0 }])
        const res = await over.run('preview')
        expect(res.results[0].changes).toEqual(expect.arrayContaining(['имя', 'пояс «Синий», 2 пол.', 'заметки']))
    })

    it('is a no-op for a member who already has everything in the row', async () => {
        const existing: User = { id: 'm1', email: 'ivan@example.com', status: 'ACTIVE', firstname: 'Иван', lastname: 'Иванов', dateOfBirth: new Date('1990-04-15T00:00:00Z'), phone: '+79001112233' }
        const world = makeWorld({
            rows: [ivan],
            users: [existing],
            members: [{ id: 'wm1', userId: 'm1', status: 'ACTIVE', notes: 'колено', subscription: null }],
        })
        world.prisma.groupMember.findMany.mockResolvedValue([{ groupId: 'adults' }])
        world.prisma.rankPromotion.findMany.mockResolvedValue([{ ladderId: 'lad', levelId: 'blue', stripes: 2 }])
        world.prisma.subscription.findMany.mockResolvedValue([
            { planId: 'p12', startDate: new Date('2026-10-24T21:00:00Z'), endDate: new Date('2026-11-23T21:00:00Z'), status: 'ACTIVE' },
        ])
        const { results, summary } = await world.run('apply')
        expect(results[0]).toMatchObject({ action: 'skip', messages: ['Без изменений'], changes: [] })
        expect(summary).toMatchObject({ skip: 1, create: 0, update: 0 })
        for (const write of world.writes) expect(write).not.toHaveBeenCalled()
    })

    it('finds a child by name and birth date, and refuses an e-mail that contradicts a member', async () => {
        const child: User = { id: 'kid', email: null, status: 'ACTIVE', firstname: 'Маша', lastname: 'Петрова', dateOfBirth: new Date('2016-09-03T00:00:00Z'), phone: null }
        const world = makeWorld({
            rows: [
                { name: 'Петрова Маша', dob: '03.09.2016', parent: 'mama@example.com' },
                { name: 'Петрова Маша', email: 'masha@example.com', dob: '03.09.2016' },
            ],
            users: [child, { id: 'mama', email: 'mama@example.com', status: 'ACTIVE', firstname: null, lastname: null, dateOfBirth: null, phone: null }],
            members: [{ id: 'wm-kid', userId: 'kid', status: 'ACTIVE', notes: null, subscription: null }],
        })
        world.prisma.guardianship.findMany.mockResolvedValue([{ guardian: { email: 'mama@example.com' } }])
        const { results } = await world.run('preview')
        expect(results[0]).toMatchObject({ action: 'skip', messages: ['Без изменений'] })
        expect(results[1]).toMatchObject({ action: 'error' })
        expect(results[1].messages[0]).toContain('e-mail в клубе другой')
    })
})
