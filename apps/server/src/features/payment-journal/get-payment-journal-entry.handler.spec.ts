import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { GetPaymentJournalEntryFeature } from './get-payment-journal-entry.feature'
import { GetPaymentJournalEntryHandler } from './get-payment-journal-entry.handler'

const OWNER_ID = 'owner-1'
const SUB_ID = '0d4e8f1a-2b3c-4d5e-8f90-a1b2c3d4e5f6'
const REG_ID = '1e5f9a2b-3c4d-4e6f-9a01-b2c3d4e5f6a7'

const rbac = () => ({
    resolveCoachScope: jest.fn(async (p: { userId: string; workspaceId: string; roleName: string | null }) => ({
        scope: p.roleName === 'coach' ? 'coach_own_only' : 'admin',
        userId: p.userId,
        workspaceId: p.workspaceId,
        workspaceOwnerId: OWNER_ID,
    })),
    canWriteAllGroups: jest.fn((ctx: { scope: string }) => ctx.scope === 'admin'),
})

type Caller = { userId: string; roleName: string }
const ADMIN: Caller = { userId: 'a-1', roleName: 'admin' }
const OWNER: Caller = { userId: OWNER_ID, roleName: 'user' }

const person = { firstname: 'Иван', lastname: 'Петров', email: 'ivan@x.ru' }
const subRow = {
    id: SUB_ID,
    paidAt: new Date('2026-11-03T11:40:00Z'),
    createdAt: new Date('2026-11-01T09:00:00Z'),
    amountPaid: 5600,
    currency: 'RUB',
    paymentMethod: 'ONLINE',
    markedPaidById: null,
    classesTotal: 8,
    userId: 'u1',
    plan: { name: '8 занятий' },
    user: person,
    workspaceMember: null,
    payment: { id: 'p1', provider: 'YOOKASSA', providerPaymentId: '2f8a-00ab12cd', status: 'SUCCEEDED' },
}
const regRow = {
    id: REG_ID,
    paidAt: new Date('2026-11-04T15:00:00Z'),
    createdAt: new Date('2026-11-01T09:00:00Z'),
    amountPaid: 1500,
    currency: 'RUB',
    paymentMethod: 'CASH',
    markedPaidById: 'coach-1',
    userId: 'u2',
    eventId: 'e1',
    event: { title: 'Семинар по гвардам', currency: 'RUB' },
    user: { firstname: 'Анна', lastname: 'Смирнова', email: null },
    payments: [],
}

const setup = () => ({
    subscription: { findFirst: jest.fn().mockResolvedValue(subRow) },
    eventRegistration: { findFirst: jest.fn().mockResolvedValue(regRow) },
    user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'coach-1', firstname: 'Пётр', lastname: 'Тренер', email: null }]),
    },
    workspaceMember: { findMany: jest.fn().mockResolvedValue([]) },
})

const run = (caller: Caller, entryId: string, prisma = setup()) => ({
    prisma,
    out: new GetPaymentJournalEntryHandler(prisma as never, rbac() as never).execute(
        new GetPaymentJournalEntryFeature(entryId, 'w1', caller.userId, caller.roleName, false),
    ),
})

describe('getPaymentJournalEntry', () => {
    it.each([
        ['a head coach', { userId: 'hc-1', roleName: 'head_coach' }],
        ['a coach', { userId: 'c-1', roleName: 'coach' }],
        ['a direction manager', { userId: 'dm-1', roleName: 'coach' }],
    ])('refuses %s before reading anything', async (_, caller) => {
        const { prisma, out } = run(caller, `sub:${SUB_ID}`)
        await expect(out).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.subscription.findFirst).not.toHaveBeenCalled()
    })

    it('an online abonement sale of a former member: no marker, no card, the provider side', async () => {
        const { prisma, out } = run(OWNER, `sub:${SUB_ID}`)
        expect(await out).toMatchObject({
            id: `sub:${SUB_ID}`,
            source: 'abonement',
            method: 'ONLINE',
            member: { userId: 'u1', name: 'Иван Петров', isMember: false },
            markedBy: null,
            online: { paymentId: 'p1', provider: 'YOOKASSA', providerRef: 'ab12cd', status: 'SUCCEEDED' },
            refunds: [],
            memberHasCard: false,
        })
        expect(prisma.subscription.findFirst.mock.calls[0][0].where).toEqual({ id: SUB_ID, workspaceId: 'w1', isPaid: true })
    })

    it('a cash ticket of a member: who marked it, the card opens', async () => {
        const prisma = setup()
        prisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'u2' }])
        const { out } = run(ADMIN, `reg:${REG_ID}`, prisma)
        expect(await out).toMatchObject({
            id: `reg:${REG_ID}`,
            source: 'ticket',
            itemName: 'Семинар по гвардам',
            eventId: 'e1',
            markedBy: { userId: 'coach-1', name: 'Пётр Тренер' },
            online: null,
            memberHasCard: true,
        })
    })

    it.each([['sub:not-a-uuid'], [`ref:${SUB_ID}`], [SUB_ID]])('%s is not found', async (entryId) => {
        const { prisma, out } = run(ADMIN, entryId)
        await expect(out).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.subscription.findFirst).not.toHaveBeenCalled()
    })

    it('an unpaid or foreign sale is not found', async () => {
        const prisma = setup()
        prisma.subscription.findFirst.mockResolvedValue(null)
        await expect(run(ADMIN, `sub:${SUB_ID}`, prisma).out).rejects.toThrow('Платёж не найден')
    })
})
