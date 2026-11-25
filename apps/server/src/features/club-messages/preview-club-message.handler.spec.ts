import { loadEmailTargets, planPush } from '../../domains/messages/deliver'
import { resolveSegmentUserIds } from '../../domains/messages/segments'
import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { PreviewClubMessageFeature } from './preview-club-message.feature'
import { PreviewClubMessageHandler } from './preview-club-message.handler'

jest.mock('../../domains/messages/segments')
jest.mock('../../domains/messages/deliver')

const DAY_NOW = new Date('2026-11-26T05:00:00Z') // 12:00 Tomsk
const NIGHT_NOW = new Date('2026-11-26T16:00:00Z') // 23:00 Tomsk

type Who = { userId: string; roleName: string | null }
const OWNER: Who = { userId: 'owner', roleName: null }
const HEAD_COACH: Who = { userId: 'hc', roleName: 'head_coach' }
const COACH: Who = { userId: 'coach', roleName: 'coach' }
const MEMBER: Who = { userId: 'm', roleName: 'user' }

const make = (p: { messagesEmailEnabled?: boolean; today?: unknown[]; membersFound?: number } = {}) => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner', coachSeesAllGroups: false, type: 'GRAPPLING' }),
            findUniqueOrThrow: jest.fn().mockResolvedValue({
                id: 'w1',
                name: 'Клуб',
                ownerId: 'owner',
                timezone: 'Asia/Tomsk',
                messagesEmailEnabled: p.messagesEmailEnabled ?? false,
            }),
        },
        group: {
            count: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
                where.id.in.filter((g) => ['own', 'other'].includes(g)).length,
            ),
            findFirst: jest.fn().mockResolvedValue({ id: 'other', directionId: null }),
            findMany: jest.fn().mockResolvedValue([{ id: 'own' }]),
        },
        groupCoach: {
            findFirst: jest.fn(async ({ where }: { where: { groupId: string } }) =>
                where.groupId === 'own' ? { role: 'primary' } : null,
            ),
        },
        directionManager: { count: jest.fn().mockResolvedValue(0) },
        workspaceMember: { count: jest.fn().mockResolvedValue(p.membersFound ?? 1) },
        clubMessage: { findMany: jest.fn().mockResolvedValue(p.today ?? []) },
    }
    const callLists = { get: jest.fn().mockResolvedValue({ scoredAt: null, entries: [] }) }
    const trialLimits = { trialEmailsLeft: jest.fn().mockResolvedValue(12) }
    const handler = new PreviewClubMessageHandler(
        prisma as never,
        new RbacService(prisma as never),
        callLists as never,
        trialLimits as never,
    )
    const preview = (who: Who, payload: Record<string, unknown>) =>
        handler.execute(
            new PreviewClubMessageFeature({ segment: 'ALL', ...payload } as never, 'w1', who.userId, who.roleName, false),
        )
    return { prisma, trialLimits, preview }
}

beforeEach(() => {
    jest.useFakeTimers({ now: DAY_NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    ;(resolveSegmentUserIds as jest.Mock).mockReset().mockResolvedValue(['s1', 's2', 'kid', 's3', 's4', 's5'])
    ;(planPush as jest.Mock).mockReset().mockResolvedValue({
        skip: new Map([
            ['s1', null],
            ['s2', 'no_device'],
            ['kid', null],
            ['s3', 'opted_out'],
            ['s4', 'muted'],
            ['s5', 'cap'],
        ]),
        routes: new Map([['kid', { guardianIds: ['mom'], dependentName: 'Миша' }]]),
    })
    ;(loadEmailTargets as jest.Mock).mockReset().mockResolvedValue(new Map([['s1', []], ['kid', []]]))
})
afterEach(() => jest.useRealTimers())

describe('PreviewClubMessageHandler', () => {
    it('refuses a student', async () => {
        await expect(make().preview(MEMBER, {})).rejects.toBeInstanceOf(ForbiddenError)
        expect(resolveSegmentUserIds).not.toHaveBeenCalled()
    })

    it('refuses a coach the sport-lead segments and the service flag, before counting anyone', async () => {
        for (const payload of [{ segment: 'UNPAID' }, { segment: 'RENEW' }, { isService: true }]) {
            await expect(make().preview(COACH, payload)).rejects.toBeInstanceOf(ForbiddenError)
        }
        await expect(make().preview(COACH, { segment: 'GROUPS', groupIds: ['other'] })).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(resolveSegmentUserIds).not.toHaveBeenCalled()
    })

    it('404s a group of another club and a student out of scope', async () => {
        await expect(make().preview(HEAD_COACH, { segment: 'GROUPS', groupIds: ['x'] })).rejects.toBeInstanceOf(
            NotFoundError,
        )
        await expect(
            make({ membersFound: 0 }).preview(COACH, { segment: 'MEMBERS', memberIds: ['s9'] }),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('counts the recipients «сейчас» and how each is reached; the owner bypasses roles', async () => {
        const { preview } = make()
        const res = await preview(OWNER, { segment: 'RENEW' })
        expect(res).toEqual({
            recipients: 6,
            children: 1,
            withPush: 2,
            optedOut: 1,
            muted: 1,
            noDevice: 1,
            capped: 1,
            withEmail: 0,
            emailEnabled: false,
            emailAllowance: null,
            sendAt: DAY_NOW.toISOString(),
            deferredByQuietHours: false,
            timezone: 'Asia/Tomsk',
            limits: { clubLeft: 10, senderLeft: null, directLeft: 50, urgentLeft: 2 },
        })
        expect((resolveSegmentUserIds as jest.Mock).mock.calls[0][1]).toMatchObject({
            target: { segment: 'RENEW' },
            scope: { groupIds: null },
        })
        expect((planPush as jest.Mock).mock.calls[0][1]).toMatchObject({ kind: 'message.broadcast' })
        expect(loadEmailTargets).not.toHaveBeenCalled()
    })

    it("a coach's preview: own groups, own limit, the kind of a direct message", async () => {
        const { preview } = make({ today: [{ authorId: 'coach', isDirect: false, urgent: true }] })
        const res = await preview(COACH, { segment: 'MEMBERS', memberIds: ['s1'] })
        expect((resolveSegmentUserIds as jest.Mock).mock.calls[0][1].scope).toEqual({ groupIds: ['own'] })
        expect((planPush as jest.Mock).mock.calls[0][1].kind).toBe('message.direct')
        expect(res.limits).toEqual({ clubLeft: 9, senderLeft: 2, directLeft: 50, urgentLeft: 1 })
    })

    it('with the club e-mail on: who gets a copy and what is left of the trial allowance', async () => {
        const { preview } = make({ messagesEmailEnabled: true })
        const res = await preview(HEAD_COACH, {})
        expect(res).toMatchObject({ withEmail: 2, emailEnabled: true, emailAllowance: 12 })
    })

    it('at night: the time it will go and why; urgent goes now', async () => {
        jest.setSystemTime(NIGHT_NOW)
        const night = await make().preview(HEAD_COACH, {})
        expect(night).toMatchObject({ sendAt: '2026-11-27T02:00:00.000Z', deferredByQuietHours: true })
        const urgent = await make().preview(HEAD_COACH, { urgent: true })
        expect(urgent).toMatchObject({ sendAt: NIGHT_NOW.toISOString(), deferredByQuietHours: false })
    })
})
