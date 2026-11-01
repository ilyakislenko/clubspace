const billingEnv = {
    selfServeSignupEnabled: true,
    trialDays: 14,
    trialPlanCode: 'club',
    plans: [{ code: 'club', name: 'Club' }],
}
jest.mock('../../environments/environment', () => ({
    // A getter: jest hoists this factory above the const it reads.
    environment: {
        get billing() {
            return billingEnv
        },
    },
}))

import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
} from '../../shared/errors/shared.errors'
import {
    CreateSelfServeWorkspaceFeature,
    CreateSelfServeWorkspaceInputSchema,
} from './create-self-serve-workspace.feature'
import { CreateSelfServeWorkspaceHandler } from './create-self-serve-workspace.handler'
import { GetSelfServeConfigHandler } from './get-self-serve-config.handler'

const p2002 = () => Object.assign(new Error('unique'), { code: 'P2002' })
const TRIAL_END = new Date('2026-11-15T00:00:00.000Z')

const build = (
    o: { trialUsed?: boolean[]; adminRole?: unknown; txError?: unknown } = {},
) => {
    const tx = {
        workspace: { create: jest.fn().mockResolvedValue({ id: 'w-new' }) },
        workspaceMember: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
    }
    const prisma = {
        role: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    'adminRole' in o ? o.adminRole : { id: 'role-admin' },
                ),
        },
        workspace: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([{ key: 'akademiya' }]),
        },
        $transaction: jest.fn(async (fn: (c: typeof tx) => unknown) => {
            if (o.txError) throw o.txError
            return fn(tx)
        }),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const used = [...(o.trialUsed ?? [false])]
    const billing = {
        hasUsedTrial: jest.fn(async () => used.shift() ?? false),
        startTrial: jest.fn().mockResolvedValue({
            trialEndsAt: TRIAL_END,
            plan: { name: 'Club' },
        }),
    }
    const handler = new CreateSelfServeWorkspaceHandler(
        prisma as never,
        audit as never,
        billing as never,
    )
    return { handler, prisma, tx, audit, billing }
}

const run = (
    handler: CreateSelfServeWorkspaceHandler,
    payload: Record<string, unknown> = {},
) =>
    handler.execute(
        new CreateSelfServeWorkspaceFeature(
            {
                name: 'Академия',
                type: 'YOGA',
                timezone: 'Asia/Novosibirsk',
                city: ' Новосибирск ',
                ...payload,
            } as never,
            'u1',
        ),
    )

afterEach(() => {
    billingEnv.selfServeSignupEnabled = true
})

describe('CreateSelfServeWorkspaceHandler', () => {
    it('refuses when self-serve signup is switched off', async () => {
        billingEnv.selfServeSignupEnabled = false
        const { handler, prisma } = build()
        await expect(run(handler)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('refuses a second trial for the same account', async () => {
        const { handler, prisma } = build({ trialUsed: [true] })
        const err = await run(handler).catch((e) => e)
        expect(err).toBeInstanceOf(ConflictError)
        expect(err.message).toContain('уже создан клуб')
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('fails clearly when the admin role is not seeded', async () => {
        const { handler } = build({ adminRole: null })
        await expect(run(handler)).rejects.toBeInstanceOf(BadRequestError)
    })

    it('creates the club with the caller as owner + admin member on a trial, and audits it', async () => {
        const { handler, tx, billing, audit } = build()
        const out = await run(handler)

        expect(tx.workspace.create.mock.calls[0][0].data).toMatchObject({
            key: 'akademiya_2',
            name: 'Академия',
            type: 'YOGA',
            timezone: 'Asia/Novosibirsk',
            city: 'Новосибирск',
            ownerId: 'u1',
            isActive: true,
        })
        expect(tx.workspaceMember.create.mock.calls[0][0].data).toEqual({
            userId: 'u1',
            workspaceId: 'w-new',
            roleId: 'role-admin',
            status: 'ACTIVE',
        })
        expect(billing.startTrial).toHaveBeenCalledWith(tx, {
            workspaceId: 'w-new',
            ownerId: 'u1',
        })
        expect(audit.record.mock.calls[0][0]).toMatchObject({
            action: 'workspace.create',
            workspaceId: 'w-new',
            actorId: 'u1',
            metadata: { selfServe: true, city: 'Новосибирск' },
        })
        expect(out).toEqual({
            workspaceId: 'w-new',
            key: 'akademiya_2',
            name: 'Академия',
            status: 'TRIAL',
            planName: 'Club',
            trialEndsAt: TRIAL_END.toISOString(),
        })
    })

    it('stores no city when none was given', async () => {
        const { handler, tx } = build()
        await run(handler, { city: '  ' })
        expect(tx.workspace.create.mock.calls[0][0].data.city).toBeNull()
    })

    it('a name with no usable characters still gets a key', async () => {
        const { handler, prisma, tx } = build()
        prisma.workspace.findMany.mockResolvedValue([])
        await run(handler, { name: '№№' })
        expect(tx.workspace.create.mock.calls[0][0].data.key).toBe('club')
    })

    it('a double submit that claimed the trial first reports the used trial', async () => {
        const { handler } = build({ trialUsed: [false, true], txError: p2002() })
        const err = await run(handler).catch((e) => e)
        expect(err).toBeInstanceOf(ConflictError)
        expect(err.message).toContain('уже создан клуб')
    })

    it('a key taken mid-flight asks to retry', async () => {
        const { handler } = build({ txError: p2002() })
        const err = await run(handler).catch((e) => e)
        expect(err).toBeInstanceOf(ConflictError)
        expect(err.message).toContain('попробуйте ещё раз')
    })

    it('rethrows anything that is not a collision', async () => {
        const { handler } = build({ txError: new Error('db down') })
        await expect(run(handler)).rejects.toThrow('db down')
    })
})

describe('CreateSelfServeWorkspaceInputSchema', () => {
    it('accepts an IANA zone and refuses a made-up one', () => {
        const base = { name: 'Клуб', type: 'FITNESS' }
        expect(
            CreateSelfServeWorkspaceInputSchema.safeParse({
                ...base,
                timezone: 'Europe/Moscow',
            }).success,
        ).toBe(true)
        expect(
            CreateSelfServeWorkspaceInputSchema.safeParse({
                ...base,
                timezone: 'Mars/Olympus',
            }).success,
        ).toBe(false)
    })
})

describe('GetSelfServeConfigHandler', () => {
    it('reports the flag, trial length and trial plan name', async () => {
        await expect(new GetSelfServeConfigHandler().execute()).resolves.toEqual({
            enabled: true,
            trialDays: 14,
            trialPlanName: 'Club',
        })
        billingEnv.selfServeSignupEnabled = false
        await expect(
            new GetSelfServeConfigHandler().execute(),
        ).resolves.toMatchObject({ enabled: false })
    })
})
