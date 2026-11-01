jest.mock('../../environments/environment', () => ({
    environment: {
        encryptionKey: 'unit-test-encryption-key',
        rootUrl: 'https://api.example.com/',
        appUrl: 'https://app.example.com',
    },
}))

import { encryptPaymentSecret } from '../../domains/payments/payment-credentials'
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

const rbac = (admin = true) => ({
    resolveCoachScope: jest
        .fn()
        .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
    canWriteAllGroups: jest.fn().mockReturnValue(admin),
})

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
    }
}

const audit = () => ({ record: jest.fn() })

const modules = () => ({ assertEntitled: jest.fn().mockResolvedValue(undefined) })

const update = (
    prisma: ReturnType<typeof prismaWith>,
    payload: ConstructorParameters<typeof UpdatePaymentSettingsFeature>[0],
    admin = true,
    a = audit(),
) =>
    new UpdatePaymentSettingsHandler(
        prisma as never,
        rbac(admin) as never,
        a as never,
        modules() as never,
    ).execute(
        new UpdatePaymentSettingsFeature(payload, 'ws-1', 'admin-1', 'admin', false),
    )

describe('payment settings — read', () => {
    it('refuses a coach', async () => {
        await expect(
            new GetPaymentSettingsHandler(
                prismaWith(null) as never,
                rbac(false) as never,
                modules() as never,
            ).execute(new GetPaymentSettingsFeature('ws-1', 'c-1', 'coach', false)),
        ).rejects.toMatchObject({ statusCode: 403 })
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
    it('refuses a coach', async () => {
        const prisma = prismaWith(null)
        await expect(
            update(prisma, { provider: 'YOOKASSA', shopId: '1', secretKey: 'live_x12345678' }, false),
        ).rejects.toMatchObject({ statusCode: 403 })
        expect(prisma.workspacePaymentSettings.create).not.toHaveBeenCalled()
    })

    it('connects YooKassa with the secret encrypted at rest', async () => {
        const prisma = prismaWith(null)
        const a = audit()
        const out = await update(
            prisma,
            { provider: 'YOOKASSA', shopId: '123456', secretKey: 'live_newsecret9876', vatCode: 11 },
            true,
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

describe('payment settings — disconnect', () => {
    it('refuses a coach', async () => {
        await expect(
            new DeletePaymentSettingsHandler(
                prismaWith(savedRow()) as never,
                rbac(false) as never,
                audit() as never,
            ).execute(new DeletePaymentSettingsFeature('ws-1', 'c-1', 'coach', false)),
        ).rejects.toMatchObject({ statusCode: 403 })
    })

    it('answers 404 when nothing is connected', async () => {
        await expect(
            new DeletePaymentSettingsHandler(
                prismaWith(null) as never,
                rbac() as never,
                audit() as never,
            ).execute(new DeletePaymentSettingsFeature('ws-1', 'a-1', 'admin', false)),
        ).rejects.toMatchObject({ statusCode: 404 })
    })

    it('erases the keys', async () => {
        const a = audit()
        const out = await new DeletePaymentSettingsHandler(
            prismaWith(savedRow()) as never,
            rbac() as never,
            a as never,
        ).execute(new DeletePaymentSettingsFeature('ws-1', 'a-1', 'admin', false))
        expect(out.connected).toBe(false)
        expect(a.record.mock.calls[0][0].metadata).toEqual({ disconnected: true })
    })
})

describe('payment settings — connection check', () => {
    const check = (
        prisma: ReturnType<typeof prismaWith>,
        gateway: { checkConnection: jest.Mock },
        admin = true,
    ) =>
        new CheckPaymentConnectionHandler(
            prisma as never,
            rbac(admin) as never,
            gateway as never,
            modules() as never,
        ).execute(new CheckPaymentConnectionFeature('ws-1', 'a-1', 'admin', false))

    it('refuses a coach and 404s without settings', async () => {
        const gateway = { checkConnection: jest.fn() }
        await expect(check(prismaWith(savedRow()), gateway, false)).rejects.toMatchObject({
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
