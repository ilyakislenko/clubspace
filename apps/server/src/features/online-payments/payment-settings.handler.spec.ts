jest.mock('../../environments/environment', () => ({
    environment: {
        encryptionKey: 'unit-test-encryption-key',
        rootUrl: 'https://api.example.com/',
        appUrl: 'https://app.example.com',
        memberAutopay: { enabled: true },
    },
}))

import { encryptPaymentSecret } from '../../domains/payments/payment-credentials'
import { environment } from '../../environments/environment'
import { PaymentGatewayError } from '../../domains/payments/payment-gateway.types'
import { ModuleNotEntitledError } from '../../shared/errors/shared.errors'
import { decrypt } from '../../shared/utils/encryption.util'
import { CheckPaymentConnectionFeature } from './check-payment-connection.feature'
import { CheckPaymentConnectionHandler } from './check-payment-connection.handler'
import { DeletePaymentSettingsFeature } from './delete-payment-settings.feature'
import { DeletePaymentSettingsHandler } from './delete-payment-settings.handler'
import { GetPaymentSettingsFeature } from './get-payment-settings.feature'
import { GetPaymentSettingsHandler } from './get-payment-settings.handler'
import { UpdatePaymentSettingsFeature } from './update-payment-settings.feature'
import { UpdatePaymentSettingsHandler } from './update-payment-settings.handler'

const KEY = 'unit-test-encryption-key'

const OWNER_ID = 'owner-1'

// Resolves the scope the way RbacService does: a head coach (like an admin)
// runs every group; only the caller's identity decides who is a club admin.
const rbac = () => ({
    resolveCoachScope: jest.fn(
        async (p: { userId: string; workspaceId: string; roleName: string | null }) => ({
            scope: p.roleName === 'coach' ? 'coach_own_only' : 'admin',
            userId: p.userId,
            workspaceId: p.workspaceId,
            workspaceOwnerId: OWNER_ID,
        }),
    ),
    canWriteAllGroups: jest.fn((ctx: { scope: string }) => ctx.scope === 'admin'),
})

type Caller = { userId: string; roleName: string }
const ADMIN: Caller = { userId: 'admin-1', roleName: 'admin' }
// The owner passes whatever their member row says.
const OWNER: Caller = { userId: OWNER_ID, roleName: 'head_coach' }
const HEAD_COACH: Caller = { userId: 'hc-1', roleName: 'head_coach' }

const savedRow = (over: Record<string, unknown> = {}) => ({
    workspaceId: 'ws-1',
    provider: 'YOOKASSA',
    shopId: '123456',
    secretKeyEncrypted: encryptPaymentSecret('live_secret_abcd', KEY),
    secretKeyHint: 'abcd',
    webhookSecretEncrypted: null,
    receiptEnabled: true,
    vatCode: 1,
    paymentSubject: 'service',
    paymentMode: 'full_prepayment',
    verifiedAt: null,
    autopayEnabled: false,
    autopayLastError: null,
    autopayLastErrorAt: null,
    ...over,
})

const prismaWith = (row: Record<string, unknown> | null) => {
    let current = row
    return {
        workspacePaymentSettings: {
            findUnique: jest.fn(async () => current),
            create: jest.fn(async ({ data }) => {
                current = { ...data }
                return current
            }),
            update: jest.fn(async ({ data }) => {
                current = { ...current, ...data }
                return current
            }),
            deleteMany: jest.fn(async () => {
                const count = current ? 1 : 0
                current = null
                return { count }
            }),
        },
        plan: { count: jest.fn().mockResolvedValue(2) },
        memberAutopay: { count: jest.fn().mockResolvedValue(0) },
    }
}

// The autopay agreements writer: the settings only tell it to stop them.
const agreements = () => ({ cancelForWorkspace: jest.fn().mockResolvedValue(0) })

const audit = () => ({ record: jest.fn() })

const modules = () => ({ assertEntitled: jest.fn().mockResolvedValue(undefined) })

const update = (
    prisma: ReturnType<typeof prismaWith>,
    payload: ConstructorParameters<typeof UpdatePaymentSettingsFeature>[0],
    caller: Caller = ADMIN,
    a = audit(),
    ag = agreements(),
) =>
    new UpdatePaymentSettingsHandler(
        prisma as never,
        rbac() as never,
        a as never,
        modules() as never,
        ag as never,
    ).execute(
        new UpdatePaymentSettingsFeature(payload, 'ws-1', caller.userId, caller.roleName, false),
    )

const read = (prisma: ReturnType<typeof prismaWith>, caller: Caller = ADMIN) =>
    new GetPaymentSettingsHandler(prisma as never, rbac() as never, modules() as never).execute(
        new GetPaymentSettingsFeature('ws-1', caller.userId, caller.roleName, false),
    )

const disconnect = (
    prisma: ReturnType<typeof prismaWith>,
    caller: Caller = ADMIN,
    ag = agreements(),
) =>
    new DeletePaymentSettingsHandler(
        prisma as never,
        rbac() as never,
        audit() as never,
        ag as never,
    ).execute(new DeletePaymentSettingsFeature('ws-1', caller.userId, caller.roleName, false))

const check = (
    prisma: ReturnType<typeof prismaWith>,
    gateway: { checkConnection: jest.Mock },
    caller: Caller = ADMIN,
) =>
    new CheckPaymentConnectionHandler(
        prisma as never,
        rbac() as never,
        gateway as never,
        modules() as never,
    ).execute(new CheckPaymentConnectionFeature('ws-1', caller.userId, caller.roleName, false))

describe('payment settings — access (club admins only)', () => {
    it('refuses a head coach on every endpoint, even one who runs every group', async () => {
        const prisma = prismaWith(savedRow())
        const gateway = { checkConnection: jest.fn() }
        for (const call of [
            () => read(prisma, HEAD_COACH),
            () => update(prisma, { provider: 'YOOKASSA', vatCode: 4 }, HEAD_COACH),
            () => disconnect(prisma, HEAD_COACH),
            () => check(prisma, gateway, HEAD_COACH),
        ]) {
            await expect(call()).rejects.toMatchObject({ statusCode: 403 })
        }
        expect(prisma.workspacePaymentSettings.update).not.toHaveBeenCalled()
        expect(prisma.workspacePaymentSettings.deleteMany).not.toHaveBeenCalled()
        expect(gateway.checkConnection).not.toHaveBeenCalled()
    })

    it.each([
        ['an admin', ADMIN],
        ['the owner', OWNER],
    ])('lets %s read, change, check and disconnect the keys', async (_, caller) => {
        const prisma = prismaWith(savedRow())
        const gateway = {
            checkConnection: jest.fn().mockResolvedValue({ accountId: '123456', testMode: false }),
        }
        await expect(read(prisma, caller)).resolves.toMatchObject({ connected: true })
        await expect(
            update(prisma, { provider: 'YOOKASSA', vatCode: 4 }, caller),
        ).resolves.toMatchObject({ vatCode: 4 })
        await expect(check(prisma, gateway, caller)).resolves.toMatchObject({ ok: true })
        await expect(disconnect(prisma, caller)).resolves.toMatchObject({ connected: false })
    })
})

describe('payment settings — read', () => {
    it('refuses a head coach', async () => {
        await expect(read(prismaWith(null), HEAD_COACH)).rejects.toMatchObject({
            statusCode: 403,
        })
    })

    it('refuses a club without the ONLINE_PAYMENTS module', async () => {
        const m = {
            assertEntitled: jest.fn().mockRejectedValue(
                new ModuleNotEntitledError({ module: 'ONLINE_PAYMENTS', message: 'нет' }),
            ),
        }
        await expect(
            new GetPaymentSettingsHandler(
                prismaWith(savedRow()) as never,
                rbac() as never,
                m as never,
            ).execute(new GetPaymentSettingsFeature('ws-1', 'a-1', 'admin', false)),
        ).rejects.toBeInstanceOf(ModuleNotEntitledError)
        expect(m.assertEntitled).toHaveBeenCalledWith('ws-1', 'ONLINE_PAYMENTS')
    })

    it('answers «not connected» with the webhook URLs to paste', async () => {
        const out = await new GetPaymentSettingsHandler(
            prismaWith(null) as never,
            rbac() as never,
            modules() as never,
        ).execute(new GetPaymentSettingsFeature('ws-1', 'a-1', 'admin', false))
        expect(out).toMatchObject({
            connected: false,
            provider: null,
            secretKeyMasked: null,
            onlinePlanCount: 2,
            webhookUrls: {
                yookassa: 'https://api.example.com/payments/webhooks/yookassa/ws-1',
                stripe: 'https://api.example.com/payments/webhooks/stripe/ws-1',
            },
        })
    })

    it('never returns a secret, only its masked tail', async () => {
        const out = await new GetPaymentSettingsHandler(
            prismaWith(savedRow({ webhookSecretEncrypted: 'x' })) as never,
            rbac() as never,
            modules() as never,
        ).execute(new GetPaymentSettingsFeature('ws-1', 'a-1', 'admin', false))
        expect(out.secretKeyMasked).toBe('••••abcd')
        expect(out.webhookSecretSet).toBe(true)
        expect(JSON.stringify(out)).not.toContain('live_secret')
        expect(out).not.toHaveProperty('secretKeyEncrypted')
    })
})

describe('payment settings — update', () => {
    it('refuses a head coach', async () => {
        const prisma = prismaWith(null)
        await expect(
            update(
                prisma,
                { provider: 'YOOKASSA', shopId: '1', secretKey: 'live_x12345678' },
                HEAD_COACH,
            ),
        ).rejects.toMatchObject({ statusCode: 403 })
        expect(prisma.workspacePaymentSettings.create).not.toHaveBeenCalled()
    })

    it('connects YooKassa with the secret encrypted at rest', async () => {
        const prisma = prismaWith(null)
        const a = audit()
        const out = await update(
            prisma,
            { provider: 'YOOKASSA', shopId: '123456', secretKey: 'live_newsecret9876', vatCode: 11 },
            ADMIN,
            a,
        )
        const data = prisma.workspacePaymentSettings.create.mock.calls[0][0].data
        expect(data.secretKeyEncrypted).not.toContain('live_newsecret')
        expect(decrypt(data.secretKeyEncrypted, KEY)).toBe('live_newsecret9876')
        expect(data).toMatchObject({
            workspaceId: 'ws-1',
            provider: 'YOOKASSA',
            shopId: '123456',
            secretKeyHint: '9876',
            vatCode: 11,
            receiptEnabled: true,
            paymentMode: 'full_prepayment',
            webhookSecretEncrypted: null,
        })
        expect(out).toMatchObject({ connected: true, secretKeyMasked: '••••9876' })
        const meta = a.record.mock.calls[0][0]
        expect(meta.action).toBe('workspace.updatePaymentSettings')
        expect(JSON.stringify(meta)).not.toContain('live_newsecret')
    })

    it('requires a secret key on first connection and shopId for YooKassa', async () => {
        await expect(
            update(prismaWith(null), { provider: 'YOOKASSA', shopId: '1' }),
        ).rejects.toMatchObject({ statusCode: 400 })
        await expect(
            update(prismaWith(null), { provider: 'YOOKASSA', secretKey: 'live_x12345678' }),
        ).rejects.toMatchObject({ statusCode: 400 })
    })

    it('requires the webhook signing secret for Stripe', async () => {
        await expect(
            update(prismaWith(null), { provider: 'STRIPE', secretKey: 'sk_test_12345678' }),
        ).rejects.toMatchObject({ statusCode: 400 })
    })

    it('requires new keys when switching provider', async () => {
        await expect(
            update(prismaWith(savedRow()), {
                provider: 'STRIPE',
                webhookSecret: 'whsec_12345678',
            }),
        ).rejects.toMatchObject({ statusCode: 400 })
    })

    it('keeps the saved secret when only the receipt settings change', async () => {
        const row = savedRow({ verifiedAt: new Date('2026-10-01T00:00:00Z') })
        const prisma = prismaWith(row)
        await update(prisma, { provider: 'YOOKASSA', vatCode: 4, paymentMode: 'full_payment' })
        const data = prisma.workspacePaymentSettings.update.mock.calls[0][0].data
        expect(data).not.toHaveProperty('secretKeyEncrypted')
        expect(data).not.toHaveProperty('verifiedAt')
        expect(data).toMatchObject({ shopId: '123456', vatCode: 4, paymentMode: 'full_payment' })
    })

    it('switches to Stripe, dropping the shopId and resetting the check', async () => {
        const prisma = prismaWith(savedRow({ verifiedAt: new Date() }))
        const out = await update(prisma, {
            provider: 'STRIPE',
            secretKey: 'sk_live_abcdefgh',
            webhookSecret: 'whsec_signing123',
        })
        const data = prisma.workspacePaymentSettings.update.mock.calls[0][0].data
        expect(data.shopId).toBeNull()
        expect(data.verifiedAt).toBeNull()
        expect(decrypt(data.webhookSecretEncrypted, KEY)).toBe('whsec_signing123')
        expect(out).toMatchObject({ provider: 'STRIPE', webhookSecretSet: true })
    })
})

// Member autopay (docs/design/2026-11-15-member-autopay.md §3.5, §10): the
// club confirms YooKassa enabled it; off, another shop or another provider
// stops every live agreement.
describe('payment settings — member autopay', () => {
    afterEach(() => {
        environment.memberAutopay.enabled = true
    })

    it('shows the toggle state, the last refusal and the live count', async () => {
        const failedAt = new Date('2026-11-14T08:00:00Z')
        const prisma = prismaWith(
            savedRow({
                autopayEnabled: true,
                autopayLastError: 'Магазин не может сохранять карты',
                autopayLastErrorAt: failedAt,
            }),
        )
        prisma.memberAutopay.count.mockResolvedValue(7)
        const out = await read(prisma)
        expect(out).toMatchObject({
            autopayOffered: true,
            autopayEnabled: true,
            autopayLastError: 'Магазин не может сохранять карты',
            autopayLastErrorAt: failedAt.toISOString(),
            autopayLiveCount: 7,
        })
        expect(prisma.memberAutopay.count.mock.calls[0][0].where).toEqual({
            workspaceId: 'ws-1',
            status: { in: ['ACTIVE', 'NEEDS_ACTION'] },
        })
        environment.memberAutopay.enabled = false
        expect((await read(prisma)).autopayOffered).toBe(false)
    })

    it('turns it on for YooKassa, clearing the last refusal', async () => {
        const prisma = prismaWith(
            savedRow({ autopayLastError: 'отказ', autopayLastErrorAt: new Date() }),
        )
        const a = audit()
        const ag = agreements()
        const out = await update(prisma, { provider: 'YOOKASSA', autopayEnabled: true }, ADMIN, a, ag)
        expect(prisma.workspacePaymentSettings.update.mock.calls[0][0].data).toMatchObject({
            autopayEnabled: true,
            autopayLastError: null,
            autopayLastErrorAt: null,
        })
        expect(out).toMatchObject({ autopayEnabled: true, autopayLastError: null })
        expect(a.record.mock.calls[0][0].metadata.autopayEnabled).toBe(true)
        expect(ag.cancelForWorkspace).not.toHaveBeenCalled()
    })

    it('keeps it on when only the receipt settings are saved', async () => {
        const prisma = prismaWith(savedRow({ autopayEnabled: true, autopayLastError: 'отказ' }))
        const ag = agreements()
        await update(prisma, { provider: 'YOOKASSA', vatCode: 4 }, ADMIN, audit(), ag)
        const data = prisma.workspacePaymentSettings.update.mock.calls[0][0].data
        expect(data.autopayEnabled).toBe(true)
        // Only a fresh confirmation clears YooKassa's refusal.
        expect(data).not.toHaveProperty('autopayLastError')
        expect(ag.cancelForWorkspace).not.toHaveBeenCalled()
    })

    it('refuses it for Stripe and while the global switch is off', async () => {
        await expect(
            update(prismaWith(null), {
                provider: 'STRIPE',
                secretKey: 'sk_test_12345678',
                webhookSecret: 'whsec_12345678',
                autopayEnabled: true,
            }),
        ).rejects.toThrow('Автоплатежи доступны только с ЮKassa')
        environment.memberAutopay.enabled = false
        const prisma = prismaWith(savedRow())
        await expect(update(prisma, { provider: 'YOOKASSA', autopayEnabled: true })).rejects.toThrow(
            'Автоплатежи учеников пока недоступны',
        )
        expect(prisma.workspacePaymentSettings.update).not.toHaveBeenCalled()
    })

    it.each([
        ['turned off', { provider: 'YOOKASSA' as const, autopayEnabled: false }, 'клуб отключил автоплатежи'],
        ['another shop', { provider: 'YOOKASSA' as const, shopId: '999999' }, 'клуб сменил магазин ЮKassa'],
        [
            'another provider',
            {
                provider: 'STRIPE' as const,
                secretKey: 'sk_live_abcdefgh',
                webhookSecret: 'whsec_signing123',
            },
            'клуб сменил платёжную систему',
        ],
    ])('stops every live agreement when %s', async (_case, payload, reason) => {
        const prisma = prismaWith(savedRow({ autopayEnabled: true }))
        const ag = agreements()
        await update(prisma, payload, ADMIN, audit(), ag)
        expect(ag.cancelForWorkspace).toHaveBeenCalledWith('ws-1', reason)
        if (payload.provider === 'STRIPE') {
            expect(prisma.workspacePaymentSettings.update.mock.calls[0][0].data.autopayEnabled).toBe(
                false,
            )
        }
    })

    it('cancels nothing when autopay was never on', async () => {
        const ag = agreements()
        await update(prismaWith(savedRow()), { provider: 'YOOKASSA', shopId: '999999' }, ADMIN, audit(), ag)
        expect(ag.cancelForWorkspace).not.toHaveBeenCalled()
    })

    it('stops every live agreement when payments are disconnected', async () => {
        const ag = agreements()
        await disconnect(prismaWith(savedRow({ autopayEnabled: true })), ADMIN, ag)
        expect(ag.cancelForWorkspace).toHaveBeenCalledWith('ws-1', 'клуб отключил онлайн-оплату')
        const none = agreements()
        await expect(disconnect(prismaWith(null), ADMIN, none)).rejects.toMatchObject({
            statusCode: 404,
        })
        expect(none.cancelForWorkspace).not.toHaveBeenCalled()
    })
})

describe('payment settings — disconnect', () => {
    it('refuses a head coach', async () => {
        await expect(disconnect(prismaWith(savedRow()), HEAD_COACH)).rejects.toMatchObject({
            statusCode: 403,
        })
    })

    it('answers 404 when nothing is connected', async () => {
        await expect(
            new DeletePaymentSettingsHandler(
                prismaWith(null) as never,
                rbac() as never,
                audit() as never,
                agreements() as never,
            ).execute(new DeletePaymentSettingsFeature('ws-1', 'a-1', 'admin', false)),
        ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('erases the keys', async () => {
        const a = audit()
        const out = await new DeletePaymentSettingsHandler(
            prismaWith(savedRow()) as never,
            rbac() as never,
            a as never,
            agreements() as never,
        ).execute(new DeletePaymentSettingsFeature('ws-1', 'a-1', 'admin', false))
        expect(out.connected).toBe(false)
        expect(a.record.mock.calls[0][0].metadata).toEqual({ disconnected: true })
    })
})

describe('payment settings — connection check', () => {
    it('refuses a head coach and 404s without settings', async () => {
        const gateway = { checkConnection: jest.fn() }
        await expect(check(prismaWith(savedRow()), gateway, HEAD_COACH)).rejects.toMatchObject({
            statusCode: 403,
        })
        await expect(check(prismaWith(null), gateway)).rejects.toMatchObject({
            statusCode: 404,
        })
        expect(gateway.checkConnection).not.toHaveBeenCalled()
    })

    it('calls the provider with the decrypted keys and stamps verifiedAt', async () => {
        const prisma = prismaWith(savedRow())
        const gateway = {
            checkConnection: jest.fn().mockResolvedValue({ accountId: '123456', testMode: true }),
        }
        const out = await check(prisma, gateway)
        expect(gateway.checkConnection.mock.calls[0][0]).toMatchObject({
            provider: 'YOOKASSA',
            shopId: '123456',
            secretKey: 'live_secret_abcd',
        })
        expect(out).toMatchObject({ ok: true, testMode: true, accountId: '123456' })
        expect(out.message).toContain('тестовый режим')
        expect(prisma.workspacePaymentSettings.update).toHaveBeenCalled()
    })

    it('reports a refusal as an answer, not an error', async () => {
        for (const [err, text] of [
            [new PaymentGatewayError('x', 401, 'bad'), 'ключи не подходят'],
            [new PaymentGatewayError('x', null), 'не отвечает'],
            [new PaymentGatewayError('x', 400, 'Shop is blocked'), 'Shop is blocked'],
        ] as const) {
            const prisma = prismaWith(savedRow())
            const out = await check(prisma, {
                checkConnection: jest.fn().mockRejectedValue(err),
            })
            expect(out.ok).toBe(false)
            expect(out.message).toContain(text)
            expect(prisma.workspacePaymentSettings.update).not.toHaveBeenCalled()
        }
    })

    it('rethrows unexpected errors', async () => {
        await expect(
            check(prismaWith(savedRow()), {
                checkConnection: jest.fn().mockRejectedValue(new Error('boom')),
            }),
        ).rejects.toThrow('boom')
    })
})
