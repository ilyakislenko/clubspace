import {
    PLATFORM_ACCESS_WINDOW_MS,
    PlatformAccessAuditService,
} from './platform-access-audit.service'

const build = (opts: {
    workspace?: { ownerId: string } | null
    membership?: { id: string } | null
    lookupError?: Error
}) => {
    const prisma = {
        workspace: {
            findUnique: opts.lookupError
                ? jest.fn().mockRejectedValue(opts.lookupError)
                : jest
                      .fn()
                      .mockResolvedValue(
                          opts.workspace === undefined
                              ? { ownerId: 'owner' }
                              : opts.workspace,
                      ),
        },
        workspaceMember: {
            findUnique: jest.fn().mockResolvedValue(opts.membership ?? null),
        },
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const service = new PlatformAccessAuditService(
        prisma as never,
        audit as never,
    )
    return { service, prisma, audit }
}

const access = {
    userId: 'admin',
    workspaceId: 'w1',
    method: 'GET',
    route: '/workspaces/:workspaceId/members',
}

describe('PlatformAccessAuditService', () => {
    afterEach(() => jest.useRealTimers())

    it('journals an outsider platform admin opening a club', async () => {
        const { service, audit } = build({})
        await service.noteAccess(access)
        expect(audit.record).toHaveBeenCalledWith({
            action: 'platform.accessClub',
            targetType: 'workspace',
            targetId: 'w1',
            workspaceId: 'w1',
            actorId: 'admin',
            metadata: {
                method: 'GET',
                route: '/workspaces/:workspaceId/members',
            },
        })
    })

    it('omits a missing route from the metadata', async () => {
        const { service, audit } = build({})
        await service.noteAccess({ ...access, route: undefined })
        expect(audit.record.mock.calls[0][0].metadata).toEqual({
            method: 'GET',
        })
    })

    it('writes once per admin and club within the window, again after it', async () => {
        jest.useFakeTimers()
        const { service, audit, prisma } = build({})
        await service.noteAccess(access)
        await service.noteAccess(access)
        expect(audit.record).toHaveBeenCalledTimes(1)
        // A different club is its own entry.
        await service.noteAccess({ ...access, workspaceId: 'w2' })
        expect(audit.record).toHaveBeenCalledTimes(2)

        jest.advanceTimersByTime(PLATFORM_ACCESS_WINDOW_MS + 1)
        await service.noteAccess(access)
        expect(audit.record).toHaveBeenCalledTimes(3)
        expect(prisma.workspace.findUnique).toHaveBeenCalledTimes(3)
    })

    it('skips the owner of the club', async () => {
        const { service, audit } = build({ workspace: { ownerId: 'admin' } })
        await service.noteAccess(access)
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('skips an admin who is a member of the club', async () => {
        const { service, audit } = build({ membership: { id: 'm1' } })
        await service.noteAccess(access)
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('skips a club that does not exist', async () => {
        const { service, audit } = build({ workspace: null })
        await service.noteAccess(access)
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('swallows a lookup failure', async () => {
        const { service, audit } = build({ lookupError: new Error('db down') })
        await expect(service.noteAccess(access)).resolves.toBeUndefined()
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('stays bounded when many clubs are opened', async () => {
        const { service, audit } = build({})
        for (let i = 0; i < 10_001; i++) {
            await service.noteAccess({ ...access, workspaceId: `w${i}` })
        }
        // The oldest pair was evicted, so it is journaled again.
        await service.noteAccess({ ...access, workspaceId: 'w0' })
        expect(audit.record).toHaveBeenCalledTimes(10_002)
    })
})
