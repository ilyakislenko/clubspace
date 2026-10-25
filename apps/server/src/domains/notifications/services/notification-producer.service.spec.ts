import { NotificationProducerService } from './notification-producer.service'

const p2002 = () => Object.assign(new Error('dup'), { code: 'P2002' })

// Every app-section flag on — the default a workspace row carries.
const allFeaturesOn = {
    announcementsEnabled: true,
    ranksEnabled: true,
    leaderboardEnabled: true,
    attendanceEnabled: true,
    subscriptionEnabled: true,
    scheduleEnabled: true,
    groupsEnabled: true,
    eventsEnabled: true,
    guestVisitsEnabled: true,
    videosEnabled: true,
    achievementsEnabled: true,
    journalEnabled: true,
}

const makePrisma = () => ({
    notificationDispatchLog: { create: jest.fn().mockResolvedValue({}) },
    notification: {
        create: jest.fn().mockResolvedValue({
            id: 'n1',
            topic: 't',
            message: 'm',
            link: null,
            type: 'PUSH',
            seen: false,
            metadata: {},
            createdAt: new Date('2026-07-07T00:00:00Z'),
        }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    workspace: {
        findUnique: jest.fn().mockResolvedValue(allFeaturesOn),
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
        emitListDeltaUsers: jest.fn(),
    } as never)

describe('notifyWorkspace', () => {
    it('stamps the club on every row, and a caller\'s own workspaceId wins', async () => {
        const prisma = makePrisma()
        prisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'a' }])
        const base = { workspaceId: 'w1', kind: 'k', topic: 't', message: 'm' }
        await svc(prisma).notifyWorkspace({ ...base, refId: 'a' })
        await svc(prisma).notifyWorkspace({
            ...base,
            refId: 'b',
            metadata: { workspaceId: 'w2' },
        })
        const meta = (i: number) =>
            prisma.notification.createMany.mock.calls[i][0].data[0].metadata
        expect(meta(0)).toMatchObject({ workspaceId: 'w1' })
        expect(meta(1)).toMatchObject({ workspaceId: 'w2' })
    })
})

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

    it('stamps the club on the row, and a caller\'s own workspaceId wins', async () => {
        const prisma = makePrisma()
        await svc(prisma).notifyUser({
            userId: 'm1',
            kind: 'k',
            refId: 'a',
            topic: 't',
            message: 'm',
            workspaceId: 'w1',
        })
        await svc(prisma).notifyUser({
            userId: 'm1',
            kind: 'k',
            refId: 'b',
            topic: 't',
            message: 'm',
            workspaceId: 'w1',
            metadata: { workspaceId: 'w2' },
        })
        const meta = (i: number) =>
            prisma.notification.create.mock.calls[i][0].data.metadata
        expect(meta(0)).toMatchObject({ workspaceId: 'w1' })
        expect(meta(1)).toMatchObject({ workspaceId: 'w2' })
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

describe('feature-flag gating', () => {
    it('notifyWorkspace suppresses the push when the section is disabled', async () => {
        const prisma = makePrisma()
        prisma.workspace.findUnique.mockResolvedValue({
            ...allFeaturesOn,
            announcementsEnabled: false,
        })
        prisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'm1' }])
        const n = await svc(prisma).notifyWorkspace({
            workspaceId: 'w1',
            kind: 'announcement.published',
            refId: 'a1',
            topic: 'T',
            message: 'B',
            feature: 'announcements',
        })
        expect(n).toBe(0)
        // Bails before claiming the dispatch token, so a later re-enable fires.
        expect(prisma.notificationDispatchLog.create).not.toHaveBeenCalled()
        expect(prisma.notification.createMany).not.toHaveBeenCalled()
    })

    it('notifyWorkspace still fires when the section is enabled', async () => {
        const prisma = makePrisma() // all features on by default
        prisma.workspaceMember.findMany.mockResolvedValue([{ userId: 'm1' }])
        const n = await svc(prisma).notifyWorkspace({
            workspaceId: 'w1',
            kind: 'announcement.published',
            refId: 'a1',
            topic: 'T',
            message: 'B',
            feature: 'announcements',
        })
        expect(n).toBe(1)
    })

    it('notifyUser suppresses the push when the section is disabled', async () => {
        const prisma = makePrisma()
        prisma.workspace.findUnique.mockResolvedValue({
            ...allFeaturesOn,
            ranksEnabled: false,
        })
        const ok = await svc(prisma).notifyUser({
            userId: 'm1',
            kind: 'rank.promoted',
            refId: 'pr1',
            topic: 'Rank',
            message: 'Blue',
            workspaceId: 'w1',
            feature: 'ranks',
        })
        expect(ok).toBe(false)
        expect(prisma.notification.create).not.toHaveBeenCalled()
    })

    it('notifyUser without a feature is never gated', async () => {
        const prisma = makePrisma()
        const ok = await svc(prisma).notifyUser({
            userId: 'm1',
            kind: 'rank.promoted',
            refId: 'pr1',
            topic: 'Rank',
            message: 'Blue',
        })
        expect(ok).toBe(true)
        expect(prisma.workspace.findUnique).not.toHaveBeenCalled()
    })
})

describe('canNotifyUser', () => {
    it('is true with no gates, and never claims anything', async () => {
        const prisma = makePrisma()
        expect(await svc(prisma).canNotifyUser({ userId: 'm1' })).toBe(true)
        expect(prisma.notificationDispatchLog.create).not.toHaveBeenCalled()
    })

    it('is false when the user opted out of the category', async () => {
        const prisma = makePrisma()
        prisma.notificationPreferences.findUnique.mockResolvedValue({
            accessExpiringEnabled: false,
        })
        expect(
            await svc(prisma).canNotifyUser({
                userId: 'm1',
                category: 'accessExpiringEnabled',
            }),
        ).toBe(false)
    })

    it('is false when the club disabled the section', async () => {
        const prisma = makePrisma()
        prisma.workspace.findUnique.mockResolvedValue({
            ...allFeaturesOn,
            subscriptionEnabled: false,
        })
        expect(
            await svc(prisma).canNotifyUser({
                userId: 'm1',
                workspaceId: 'w1',
                feature: 'subscription',
            }),
        ).toBe(false)
    })
})
