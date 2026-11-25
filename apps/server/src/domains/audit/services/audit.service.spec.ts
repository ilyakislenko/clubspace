import { AuditService } from './audit.service'

const GYM = '11111111-1111-4111-8111-111111111111'
const GROUP = '22222222-2222-4222-8222-222222222222'
const DIRECTION = '33333333-3333-4333-8333-333333333333'
const USER = '44444444-4444-4444-8444-444444444444'
const GONE = '55555555-5555-4555-8555-555555555555'

const event = (over: Record<string, unknown>) => ({
    id: `e-${Math.random()}`,
    workspaceId: 'w1',
    actorId: null,
    actorEmail: null,
    action: 'gym.update',
    targetType: 'gym',
    targetId: null,
    metadata: null,
    createdAt: new Date('2026-11-14T10:00:00Z'),
    ...over,
})

// Every lookup answers from a small fixed club; anything else is "deleted".
const make = (rows: Record<string, unknown>[]) => {
    const byId = <T extends { id: string }>(items: T[]) => ({
        findMany: jest.fn(({ where }: { where: { id: { in: string[] } } }) =>
            Promise.resolve(items.filter((x) => where.id.in.includes(x.id))),
        ),
    })
    const prisma = {
        $transaction: jest.fn().mockResolvedValue([rows, rows.length]),
        auditEvent: { findMany: jest.fn(), count: jest.fn() },
        user: byId([{ id: USER, email: 'ivan@x.ru', firstname: 'Иван', lastname: 'Петров' }]),
        video: byId([]),
        course: byId([]),
        gym: byId([{ id: GYM, name: 'Север' }]),
        group: byId([{ id: GROUP, name: 'Взрослые' }]),
        groupScheduleSlot: byId([]),
        scheduleException: byId([]),
        workspaceEvent: byId([]),
        role: byId([]),
        chapter: byId([]),
        direction: byId([{ id: DIRECTION, name: 'БЖЖ' }]),
    }
    return new AuditService(prisma as never)
}

describe('AuditService.list labels', () => {
    it('names the hall, group and direction an entry is about', async () => {
        const service = make([
            event({ targetType: 'gym', targetId: GYM }),
            event({ targetType: 'group', targetId: GROUP }),
            event({ targetType: 'direction', targetId: DIRECTION }),
            event({ targetType: 'direction', targetId: GONE }),
        ])
        const { data } = await service.list({ workspaceId: 'w1' })
        expect(data.map((e) => e.targetLabel)).toEqual(['Север', 'Взрослые', 'БЖЖ', null])
    })

    it('swaps ids under known keys for names and keeps an unknown one as it is', async () => {
        const service = make([
            event({
                action: 'group.addMember',
                targetType: 'group',
                targetId: GROUP,
                metadata: { userId: USER, gymId: GYM, slotId: GONE },
            }),
        ])
        const { data } = await service.list({ workspaceId: 'w1' })
        expect(data[0].metadata).toEqual({
            userId: 'Иван Петров (ivan@x.ru)',
            gymId: 'Север',
            slotId: GONE,
        })
    })

    it('names the guardian who paid for a child on payment.succeeded', async () => {
        const service = make([
            event({
                action: 'payment.succeeded',
                targetType: 'member',
                actorId: USER,
                metadata: { paymentId: GONE, payerUserId: USER, amount: 4000 },
            }),
        ])
        const { data } = await service.list({ workspaceId: 'w1' })
        expect(data[0].metadata).toMatchObject({ payerUserId: 'Иван Петров (ivan@x.ru)', amount: 4000 })
    })
})
