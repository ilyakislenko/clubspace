jest.mock('../environments/environment', () => ({
    environment: { adminEmail: 'Admin@Super.com', seedDemoWorkspace: false },
}))

jest.mock('../domains/email-templates/services/email-templates.service', () => ({ EmailTemplatesService: class {} }))
jest.mock('../domains/roles/services/roles.service', () => ({ RolesService: class {} }))
jest.mock('../domains/tfa/services/tfa.service', () => ({ TfaService: class {} }))
jest.mock('../infrastructure/prisma/prisma.service', () => ({ PrismaService: class {} }))

import { BootstrapSeedService } from './bootstrap-seed.service'

const build = (opts: { updated?: number; skipped?: { id: string }[]; fail?: boolean } = {}) => {
    const prisma = {
        $executeRaw: opts.fail
            ? jest.fn().mockRejectedValue(new Error('db down'))
            : jest.fn().mockResolvedValue(opts.updated ?? 0),
        $queryRaw: jest.fn().mockResolvedValue(opts.skipped ?? []),
        user: {
            findUnique: jest.fn().mockResolvedValue({ id: 'a', isSuperAdmin: true }),
            create: jest.fn(),
            update: jest.fn(),
        },
    }
    const service = new BootstrapSeedService(
        {} as never,
        {} as never,
        {} as never,
        prisma as never,
    )
    const logger = (service as unknown as { logger: Record<string, jest.Mock> })
        .logger
    logger.log = jest.fn()
    logger.warn = jest.fn()
    logger.error = jest.fn()
    return { service, prisma, logger }
}

describe('BootstrapSeedService.normalizeLegacyEmails', () => {
    it('issues the lowercasing statement once, as a tagged template', async () => {
        const { service, prisma } = build({ updated: 2 })
        await service.normalizeLegacyEmails()
        expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)
        const [strings] = prisma.$executeRaw.mock.calls[0]
        expect(Array.isArray(strings)).toBe(true)
        expect(strings.join('')).toContain('lower(')
        expect(strings.join('')).toContain('NOT EXISTS')
    })

    it('warns with ids only for case-duplicates it skipped', async () => {
        const { service, logger } = build({ skipped: [{ id: 'u1' }, { id: 'u2' }] })
        await service.normalizeLegacyEmails()
        const msg = logger.warn.mock.calls[0][0] as string
        expect(msg).toContain('2 account(s)')
        expect(msg).toContain('u1, u2')
        expect(msg).not.toContain('@')
    })

    it('never crashes boot when the statement fails', async () => {
        const { service, logger } = build({ fail: true })
        await expect(service.normalizeLegacyEmails()).resolves.toBeUndefined()
        expect(logger.error).toHaveBeenCalled()
    })
})

describe('BootstrapSeedService.setupPlatformOwner', () => {
    it('looks the platform owner up by the lowercased address', async () => {
        const { service, prisma } = build()
        await service.setupPlatformOwner()
        expect(prisma.user.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { email: 'admin@super.com' } }),
        )
    })
})
