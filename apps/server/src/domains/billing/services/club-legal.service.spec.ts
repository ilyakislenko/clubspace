const billingEnv = {
    enabled: true,
    legal: { offerVersion: '2026-12-01', dpaVersion: '2026-11-01', acceptGraceDays: 14 },
}
jest.mock('../../../environments/environment', () => ({
    // A getter: jest hoists this factory above the const it reads.
    environment: {
        get billing() {
            return billingEnv
        },
    },
}))

import {
    LegalAcceptanceRequiredError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import { ClubLegalService } from './club-legal.service'

const CREATED = new Date('2026-06-01T00:00:00.000Z')
const OLD = {
    offerVersion: '2026-11-01',
    dpaVersion: '2026-11-01',
    acceptedAt: new Date('2026-11-02T00:00:00.000Z'),
}

const build = (o: { latest?: unknown; ws?: unknown; convertedAt?: Date | null; existing?: unknown } = {}) => {
    const prisma = {
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue('ws' in o ? o.ws : { ownerId: 'owner', createdAt: CREATED }),
        },
        workspaceBilling: {
            findUnique: jest.fn().mockResolvedValue({ convertedAt: o.convertedAt ?? null }),
        },
        user: {
            findUnique: jest.fn().mockResolvedValue({
                email: 'owner@club.ru',
                firstname: 'Иван',
                lastname: 'Петров',
            }),
        },
        clubLegalAcceptance: {
            findFirst: jest.fn(async (args: { where: { paymentId?: string } }) =>
                args.where.paymentId ? (o.existing ?? null) : ('latest' in o ? o.latest : OLD),
            ),
            findMany: jest.fn().mockResolvedValue([]),
            create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
                id: 'acc-1',
                acceptedAt: new Date('2026-12-02T00:00:00.000Z'),
                ...args.data,
            })),
        },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    return { service: new ClubLegalService(prisma as never, audit as never), prisma, audit }
}

afterEach(() => {
    billingEnv.enabled = true
})

describe('ClubLegalService', () => {
    it('404s on a missing club', async () => {
        const { service } = build({ ws: null })
        await expect(service.getState('w1')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('reports a new edition with the grace from its date', async () => {
        const { service } = build()
        const state = await service.getState('w1', new Date('2026-12-05T00:00:00.000Z'))
        expect(state).toMatchObject({
            current: { offerVersion: '2026-12-01', dpaVersion: '2026-11-01' },
            ownerId: 'owner',
            status: {
                upToDate: false,
                acceptBy: new Date('2026-12-15T00:00:00.000Z'),
                required: false,
            },
        })
    })

    it('records the current editions with an owner snapshot, trimmed to the columns', async () => {
        const { service, prisma } = build()
        await service.record({
            workspaceId: 'w1',
            userId: 'owner',
            source: 'OWNER',
            ip: '1'.repeat(80),
            userAgent: 'u'.repeat(600),
        })
        const data = prisma.clubLegalAcceptance.create.mock.calls[0][0].data
        expect(data).toMatchObject({
            workspaceId: 'w1',
            userId: 'owner',
            userEmail: 'owner@club.ru',
            userName: 'Иван Петров',
            offerVersion: '2026-12-01',
            dpaVersion: '2026-11-01',
            source: 'OWNER',
            recordedById: null,
            paymentId: null,
        })
        expect(data.ip).toHaveLength(64)
        expect(data.userAgent).toHaveLength(512)
    })

    it('records through a transaction client when given one', async () => {
        const { service, prisma } = build()
        const tx = {
            user: { findUnique: jest.fn().mockResolvedValue(null) },
            clubLegalAcceptance: { create: jest.fn().mockResolvedValue({ id: 'acc-tx' }) },
        }
        await service.record({ workspaceId: 'w1', userId: 'owner', source: 'SIGNUP' }, tx as never)
        expect(tx.clubLegalAcceptance.create.mock.calls[0][0].data).toMatchObject({
            userEmail: null,
            userName: null,
            source: 'SIGNUP',
        })
        expect(prisma.clubLegalAcceptance.create).not.toHaveBeenCalled()
    })

    it('journals an acceptance', async () => {
        const { service, audit } = build()
        await service.accept({ workspaceId: 'w1', userId: 'owner', source: 'OWNER' })
        expect(audit.record.mock.calls[0][0]).toMatchObject({
            action: 'workspace.legalAccept',
            workspaceId: 'w1',
            actorId: 'owner',
            metadata: { source: 'OWNER', offerVersion: '2026-12-01', dpaVersion: '2026-11-01' },
        })
    })

    describe('acceptByFirstPayment', () => {
        const pay = { workspaceId: 'w1', paymentId: 'p1', ip: '10.0.0.1', userAgent: 'Safari' }

        it('records the owner’s first payment as acceptance', async () => {
            const { service, prisma } = build()
            const row = await service.acceptByFirstPayment({ ...pay, userId: 'owner' })
            expect(row).not.toBeNull()
            expect(prisma.clubLegalAcceptance.create.mock.calls[0][0].data).toMatchObject({
                source: 'PAYMENT',
                paymentId: 'p1',
                ip: '10.0.0.1',
            })
        })

        it('records nothing for another admin, a converted club, or the same payment again', async () => {
            for (const o of [{}, { convertedAt: new Date() }, { existing: { id: 'acc-0' } }]) {
                const { service, prisma } = build(o)
                const userId = Object.keys(o).length === 0 ? 'admin' : 'owner'
                await expect(service.acceptByFirstPayment({ ...pay, userId })).resolves.toBeNull()
                expect(prisma.clubLegalAcceptance.create).not.toHaveBeenCalled()
            }
        })
    })

    describe('assertPaidActionsAllowed', () => {
        it('lets paid actions through within the grace', async () => {
            const { service } = build()
            await expect(
                service.assertPaidActionsAllowed('w1', new Date('2026-12-14T00:00:00.000Z')),
            ).resolves.toBeUndefined()
        })

        it('refuses them once the grace is over', async () => {
            const { service } = build()
            await expect(
                service.assertPaidActionsAllowed('w1', new Date('2026-12-15T00:00:00.000Z')),
            ).rejects.toBeInstanceOf(LegalAcceptanceRequiredError)
        })

        it('lets them through once the current editions are accepted', async () => {
            const { service } = build({
                latest: { ...OLD, offerVersion: '2026-12-01' },
            })
            await expect(
                service.assertPaidActionsAllowed('w1', new Date('2027-06-01T00:00:00.000Z')),
            ).resolves.toBeUndefined()
        })

        it('gates nothing on a self-hosted install', async () => {
            billingEnv.enabled = false
            const { service, prisma } = build()
            await expect(
                service.assertPaidActionsAllowed('w1', new Date('2030-01-01T00:00:00.000Z')),
            ).resolves.toBeUndefined()
            expect(prisma.workspace.findUnique).not.toHaveBeenCalled()
        })
    })
})
