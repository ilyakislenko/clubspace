import { NotificationProducerService } from './notification-producer.service'

const p2002 = () => Object.assign(new Error('dup'), { code: 'P2002' })

const makePrisma = () => ({
    notificationDispatchLog: { create: jest.fn().mockResolvedValue({}) },
    notification: {
        create: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    workspaceMember: { findMany: jest.fn().mockResolvedValue([]) },
    notificationPreferences: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
    },
})
const svc = (prisma: ReturnType<typeof makePrisma>) =>
    new NotificationProducerService(prisma as never, {
        invalidateUsers: jest.fn(),
    } as never)

describe('notifyUser', () => {
    it('creates one notification with kind in metadata and sent=false', async () => {
        const prisma = makePrisma()
        const ok = await svc(prisma).notifyUser({
            userId: 'm1',
            kind: 'rank.promoted',
            refId: 'pr1',
            topic: 'Rank',
            message: 'Blue belt',
            metadata: { promotionId: 'pr1' },
        })
        expect(ok).toBe(true)
        const data = prisma.notification.create.mock.calls[0][0].data
        expect(data).toMatchObject({
            userId: 'm1',
            sent: false,
            seen: false,
        })
        expect(data.metadata).toMatchObject({
            kind: 'rank.promoted',
            promotionId: 'pr1',
        })
    })

    it('is idempotent: a claimed (kind,refId) skips the create', async () => {
        const prisma = makePrisma()
        prisma.notificationDispatchLog.create.mockRejectedValue(p2002())
        const ok = await svc(prisma).notifyUser({
            userId: 'm1',
            kind: 'rank.promoted',
            refId: 'pr1',
            topic: 'x',
            message: 'y',
        })
        expect(ok).toBe(false)
        expect(prisma.notification.create).not.toHaveBeenCalled()
    })

    it('skips (and never claims) when the user opted out of the category', async () => {
        const prisma = makePrisma()
        prisma.notificationPreferences.findUnique.mockResolvedValue({
            promotionsEnabled: false,
        })
        const ok = await svc(prisma).notifyUser({
            userId: 'm1',
            kind: 'rank.promoted',
            refId: 'pr1',
            topic: 'x',
            message: 'y',
            category: 'promotionsEnabled',
        })
        expect(ok).toBe(false)
        expect(prisma.notificationDispatchLog.create).not.toHaveBeenCalled()
        expect(prisma.notification.create).not.toHaveBeenCalled()
    })

    it('sends when the category is enabled (missing prefs row = default on)', async () => {
        const prisma = makePrisma()
        const ok = await svc(prisma).notifyUser({
            userId: 'm1',
            kind: 'rank.promoted',
            refId: 'pr1',
            topic: 'x',
            message: 'y',
            category: 'promotionsEnabled',
        })
        expect(ok).toBe(true)
        expect(prisma.notification.create).toHaveBeenCalledTimes(1)
    })
})

describe('notifyWorkspace', () => {
    it('fans out to ACTIVE members excluding the actor', async () => {
        const prisma = makePrisma()
        prisma.workspaceMember.findMany.mockResolvedValue([
            { userId: 'm1' },
            { userId: 'm2' },
        ])
        const n = await svc(prisma).notifyWorkspace({
            workspaceId: 'w1',
            kind: 'announcement.published',
            refId: 'a1',
            topic: 'T',
            message: 'B',
            excludeUserId: 'author',
        })
        expect(n).toBe(2)
        const where = prisma.workspaceMember.findMany.mock.calls[0][0].where
        expect(where).toMatchObject({
            workspaceId: 'w1',
            status: 'ACTIVE',
            userId: { not: 'author' },
        })
        expect(prisma.notification.createMany.mock.calls[0][0].data).toHaveLength(
            2,
        )
    })

    it('no-ops (count 0) when already dispatched', async () => {
        const prisma = makePrisma()
        prisma.notificationDispatchLog.create.mockRejectedValue(p2002())
        const n = await svc(prisma).notifyWorkspace({
            workspaceId: 'w1',
            kind: 'announcement.published',
            refId: 'a1',
            topic: 'T',
            message: 'B',
        })
        expect(n).toBe(0)
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
    })

    it('drops recipients who opted out of the category', async () => {
        const prisma = makePrisma()
        prisma.workspaceMember.findMany.mockResolvedValue([
            { userId: 'm1' },
            { userId: 'm2' },
        ])
        prisma.notificationPreferences.findMany.mockResolvedValue([
            { userId: 'm2' },
        ])
        const n = await svc(prisma).notifyWorkspace({
            workspaceId: 'w1',
            kind: 'announcement.published',
            refId: 'a1',
            topic: 'T',
            message: 'B',
            category: 'announcementsEnabled',
        })
        expect(n).toBe(1)
        const data = prisma.notification.createMany.mock.calls[0][0].data
        expect(data).toHaveLength(1)
        expect(data[0].userId).toBe('m1')
    })
})
