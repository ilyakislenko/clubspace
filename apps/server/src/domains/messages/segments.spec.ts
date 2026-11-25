import type { CallList, CallListEntry } from '../retention/call-list'
import { renewalDueUserIds } from '../subscriptions/renewal-rules'
import type { MessageScope, SegmentTarget } from './segment-where'
import { resolveSegmentUserIds } from './segments'

jest.mock('../subscriptions/renewal-rules', () => ({
    ...jest.requireActual('../subscriptions/renewal-rules'),
    renewalDueUserIds: jest.fn(),
}))

const NOW = new Date('2026-11-26T05:00:00Z')

const entry = (userId: string, groupIds: string[], snoozed = false) =>
    ({
        userId,
        groups: groupIds.map((id) => ({ id, name: id, gymId: null, gymName: null })),
        snoozed,
    }) as unknown as CallListEntry

const CALL_LIST: CallList = {
    scoredAt: null,
    entries: [
        entry('a', ['own']),
        entry('b', ['other']),
        entry('c', ['own'], true),
        entry('d', ['own', 'other']),
    ],
}

const make = (rows: { userId: string }[] = [{ userId: 'x' }]) => {
    const prisma = {
        workspace: {},
        workspaceMember: { findMany: jest.fn().mockResolvedValue(rows) },
    }
    const callList = jest.fn().mockResolvedValue(CALL_LIST)
    const run = (t: Partial<SegmentTarget>, scope: MessageScope = { groupIds: null }) =>
        resolveSegmentUserIds(prisma as never, {
            workspaceId: 'w1',
            ownerId: 'owner',
            target: { segment: 'ALL', directionId: null, groupIds: [], memberIds: [], ...t },
            scope,
            now: NOW,
            callList,
        })
    return { prisma, callList, run }
}

// The ids the final member query was narrowed to (RENEW / CALL_LIST).
const resolvedIdsOf = (findMany: jest.Mock) => {
    const and = findMany.mock.calls[0][0].where.AND as Array<{ userId?: { in?: string[] } }>
    return and[1].userId?.in
}

beforeEach(() => (renewalDueUserIds as jest.Mock).mockReset())

describe('resolveSegmentUserIds', () => {
    it('returns each student once', async () => {
        const { run } = make([{ userId: 'u1' }, { userId: 'u1' }, { userId: 'u2' }])
        expect(await run({ segment: 'ALL' })).toEqual(['u1', 'u2'])
    })

    it('CALL_LIST: only the open rows (snoozed are out) of the whole club for a sport lead', async () => {
        const { run, prisma, callList } = make()
        await run({ segment: 'CALL_LIST' })
        expect(callList).toHaveBeenCalledTimes(1)
        expect(resolvedIdsOf(prisma.workspaceMember.findMany)).toEqual(['a', 'b', 'd'])
    })

    it('CALL_LIST: a coach gets the open rows of their own groups only', async () => {
        const { run, prisma } = make()
        await run({ segment: 'CALL_LIST' }, { groupIds: ['own'] })
        expect(resolvedIdsOf(prisma.workspaceMember.findMany)).toEqual(['a', 'd'])
    })

    it('RENEW: the «Продлить» list, narrowed to the scope inside the renewal rule', async () => {
        ;(renewalDueUserIds as jest.Mock).mockResolvedValue(['r1'])
        const { run, prisma } = make()
        await run({ segment: 'RENEW' }, { groupIds: ['own'] })
        expect(renewalDueUserIds).toHaveBeenCalledWith(prisma, 'w1', NOW, {
            memberWhere: { user: { groupMemberships: { some: { groupId: { in: ['own'] } } } } },
        })
        expect(resolvedIdsOf(prisma.workspaceMember.findMany)).toEqual(['r1'])
    })

    it('RENEW for a sport lead passes no narrowing', async () => {
        ;(renewalDueUserIds as jest.Mock).mockResolvedValue(['r1'])
        const { run, prisma } = make()
        await run({ segment: 'RENEW' })
        expect(renewalDueUserIds).toHaveBeenCalledWith(prisma, 'w1', NOW, {})
    })

    it('an empty computed list skips the member query', async () => {
        ;(renewalDueUserIds as jest.Mock).mockResolvedValue([])
        const { run, prisma } = make()
        expect(await run({ segment: 'RENEW' })).toEqual([])
        expect(prisma.workspaceMember.findMany).not.toHaveBeenCalled()
    })

    it('does not read the call list for other segments', async () => {
        const { run, callList } = make()
        await run({ segment: 'INACTIVE' })
        expect(callList).not.toHaveBeenCalled()
        expect(renewalDueUserIds).not.toHaveBeenCalled()
    })
})
