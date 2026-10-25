import { loadWorkspaceRisk } from './load-workspace-risk'
import { RetentionDigestService } from './retention-digest.service'

jest.mock('./load-workspace-risk')

// Monday 10:05 in Tomsk (UTC+7).
const DUE = new Date('2026-10-26T03:05:00Z')
const NOT_DUE = new Date('2026-10-26T05:05:00Z')

const entry = (userId: string, groupId: string, reason = 'absent') => ({
    userId,
    groups: [{ id: groupId, name: groupId, gymId: null, gymName: null }],
    risk: { reason, signals: [reason] },
    snoozed: false,
})

const make = (claim: () => Promise<unknown> = () => Promise.resolve({})) => {
    const prisma = {
        workspace: {
            findMany: jest
                .fn()
                .mockResolvedValue([{ id: 'w1', name: 'Клуб', timezone: 'Asia/Tomsk' }]),
        },
        notificationDispatchLog: { create: jest.fn().mockImplementation(claim) },
        groupCoach: {
            findMany: jest.fn().mockResolvedValue([
                { userId: 'c1', groupId: 'g1' },
                { userId: 'c2', groupId: 'g2' },
            ]),
        },
    }
    const notifications = { notifyUser: jest.fn().mockResolvedValue(true) }
    const svc = new RetentionDigestService(prisma as never, notifications as never)
    return { svc, prisma, notifications }
}

beforeEach(() => {
    ;(loadWorkspaceRisk as jest.Mock)
        .mockReset()
        .mockResolvedValue([entry('s1', 'g1'), entry('s2', 'g1', 'lapsed')])
})

describe('RetentionDigestService', () => {
    it('only lists workspaces when the slot is not due', async () => {
        const { svc, prisma, notifications } = make()
        expect(await svc.run(NOT_DUE)).toEqual({ workspaces: 0, sent: 0 })
        expect(prisma.workspace.findMany).toHaveBeenCalledTimes(1)
        expect(prisma.notificationDispatchLog.create).not.toHaveBeenCalled()
        expect(loadWorkspaceRisk).not.toHaveBeenCalled()
        expect(notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('claims the run, loads once, and notifies a coach with the exact payload', async () => {
        const { svc, prisma, notifications } = make()
        expect(await svc.run(DUE)).toEqual({ workspaces: 1, sent: 1 })
        expect(prisma.notificationDispatchLog.create.mock.calls[0][0].data).toEqual({
            kind: 'retention.digest.run',
            refId: 'w1:2026-10-26',
        })
        expect(loadWorkspaceRisk).toHaveBeenCalledTimes(1)
        expect(notifications.notifyUser).toHaveBeenCalledTimes(1)
        expect(notifications.notifyUser).toHaveBeenCalledWith({
            userId: 'c1',
            kind: 'retention.digest',
            refId: 'w1:c1:2026-10-26',
            topic: 'Кому позвонить на этой неделе',
            message:
                'Клуб: 2 ученика из ваших групп могут уйти. Откройте список и позвоните.',
            metadata: {
                workspaceId: 'w1',
                count: 2,
                byReason: { lapsed: 1, newcomer: 0, absent: 1, declining: 0 },
            },
        })
    })

    it('skips the whole workspace when the run was already claimed', async () => {
        const { svc, notifications } = make(() => Promise.reject({ code: 'P2002' }))
        expect(await svc.run(DUE)).toEqual({ workspaces: 0, sent: 0 })
        expect(loadWorkspaceRisk).not.toHaveBeenCalled()
        expect(notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('rethrows an unexpected claim failure', async () => {
        const { svc } = make(() => Promise.reject(new Error('db down')))
        await expect(svc.run(DUE)).rejects.toThrow('db down')
    })

    it('does not count a notification the producer declined to send', async () => {
        const { svc, notifications } = make()
        notifications.notifyUser.mockResolvedValue(false)
        expect(await svc.run(DUE)).toEqual({ workspaces: 1, sent: 0 })
    })
})
