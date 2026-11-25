import { loadWorkspaceRisk } from '../../domains/retention/load-workspace-risk'
import type { CallList, CallListEntry } from '../../domains/retention/call-list'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { SendClubMessageFeature } from './send-club-message.feature'
import { SendClubMessageHandler } from './send-club-message.handler'

jest.mock('../../domains/retention/load-workspace-risk')

// 12:00 in Tomsk (UTC+7): outside quiet hours.
const DAY_NOW = new Date('2026-11-26T05:00:00Z')
// 23:00 in Tomsk.
const NIGHT_NOW = new Date('2026-11-26T16:00:00Z')

type Who = { userId: string; roleName: string | null }
const OWNER: Who = { userId: 'owner', roleName: null }
const ADMIN: Who = { userId: 'adm', roleName: 'admin' }
const HEAD_COACH: Who = { userId: 'hc', roleName: 'head_coach' }
const COACH: Who = { userId: 'coach', roleName: 'coach' }
const MEMBER: Who = { userId: 'm', roleName: 'user' }

const entry = (userId: string, groupIds: string[], snoozed = false) =>
    ({ userId, groups: groupIds.map((id) => ({ id })), snoozed }) as unknown as CallListEntry
const CALL_LIST: CallList = {
    scoredAt: null,
    entries: [entry('s1', ['own']), entry('s2', ['other']), entry('s3', ['own'], true)],
}

type Setup = {
    messagesEmailEnabled?: boolean
    // Groups of this club (others are «another club»).
    clubGroups?: string[]
    // The coach's own groups (GroupCoach rows).
    coachGroups?: string[]
    // Group → its direction.
    groupDirection?: Record<string, string>
    // Directions the coach runs.
    managedDirections?: string[]
    clubDirections?: string[]
    // Students the MEMBERS check finds in the sender's scope.
    membersFound?: number
    // Today's messages of the club.
    today?: Array<{ authorId: string; isDirect: boolean; urgent: boolean }>
}

const make = (s: Setup = {}) => {
    const clubGroups = s.clubGroups ?? ['own', 'other']
    const coachGroups = s.coachGroups ?? ['own']
    const managed = s.managedDirections ?? []
    const created: Record<string, unknown>[] = []
    let delivered = false
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner', coachSeesAllGroups: false, type: 'GRAPPLING' }),
            findUniqueOrThrow: jest.fn().mockResolvedValue({
                id: 'w1',
                name: 'Клуб',
                ownerId: 'owner',
                timezone: 'Asia/Tomsk',
                messagesEmailEnabled: s.messagesEmailEnabled ?? false,
            }),
        },
        group: {
            count: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
                where.id.in.filter((g) => clubGroups.includes(g)).length,
            ),
            findFirst: jest.fn(async ({ where }: { where: { id: string } }) =>
                clubGroups.includes(where.id)
                    ? { id: where.id, directionId: s.groupDirection?.[where.id] ?? null }
                    : null,
            ),
            // ownGroupIds (select id) or the audience label (select name).
            findMany: jest.fn(async ({ select }: { select: { name?: boolean } }) =>
                select.name
                    ? clubGroups.map((id) => ({ id, name: `Группа ${id}` }))
                    : [...coachGroups, ...clubGroups.filter((g) => managed.includes(s.groupDirection?.[g] ?? ''))].map(
                          (id) => ({ id }),
                      ),
            ),
        },
        groupCoach: {
            findFirst: jest.fn(async ({ where }: { where: { groupId: string } }) =>
                coachGroups.includes(where.groupId) ? { role: 'primary' } : null,
            ),
        },
        directionManager: {
            count: jest.fn(async ({ where }: { where: { directionId: { in: string[] } } }) =>
                where.directionId.in.filter((d) => managed.includes(d)).length,
            ),
        },
        direction: {
            findFirst: jest.fn(async ({ where }: { where: { id: string } }) =>
                (s.clubDirections ?? ['bjj', 'judo']).includes(where.id) ? { id: where.id } : null,
            ),
            findMany: jest.fn().mockResolvedValue([{ id: 'bjj', name: 'BJJ' }]),
        },
        workspaceMember: {
            count: jest.fn().mockResolvedValue(s.membersFound ?? 1),
        },
        clubMessage: {
            findMany: jest.fn().mockResolvedValue(s.today ?? []),
            create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
                created.push(data)
                return { id: 'm1', segment: data.segment, sendAt: data.sendAt }
            }),
            findUniqueOrThrow: jest.fn(async () => {
                const d = created[created.length - 1]
                return {
                    id: 'm1',
                    title: d.title,
                    body: d.body,
                    authorName: d.authorName,
                    segment: d.segment,
                    directionId: d.directionId,
                    groupIds: d.groupIds,
                    memberIds: d.memberIds,
                    isDirect: d.isDirect,
                    isService: d.isService,
                    urgent: d.urgent,
                    withEmail: d.withEmail,
                    status: delivered ? 'SENT' : 'SCHEDULED',
                    sendAt: d.sendAt,
                    sentAt: delivered ? d.sendAt : null,
                    recipientCount: delivered ? 7 : 0,
                    pushCount: delivered ? 5 : 0,
                    emailCount: 0,
                    readCount: 0,
                    createdAt: DAY_NOW,
                }
            }),
        },
        user: {
            findUnique: jest.fn().mockResolvedValue({ firstname: 'Анна', lastname: 'Петрова', email: 'a@x.io' }),
            findMany: jest.fn().mockResolvedValue([{ id: 's1', firstname: 'Иван', lastname: 'Иванов', email: null }]),
        },
        memberRetentionContact: { create: jest.fn().mockResolvedValue({ id: 'c1' }) },
        $executeRaw: jest.fn().mockResolvedValue(1),
    }
    // The limits-and-insert transaction runs on the same mock.
    Object.assign(prisma, {
        $transaction: jest.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma)),
    })
    const delivery = {
        deliver: jest.fn(async () => {
            delivered = true
            return true
        }),
    }
    const callLists = {
        get: jest.fn().mockResolvedValue(CALL_LIST),
        invalidate: jest.fn().mockResolvedValue(undefined),
    }
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidateCoalesced: jest.fn() }
    const handler = new SendClubMessageHandler(
        prisma as never,
        new RbacService(prisma as never),
        audit as never,
        delivery as never,
        callLists as never,
        realtime as never,
    )
    const send = (who: Who, payload: Record<string, unknown>) =>
        handler.execute(
            new SendClubMessageFeature(
                { title: 'Сбор', body: 'Текст', segment: 'ALL', ...payload } as never,
                'w1',
                who.userId,
                who.roleName,
                false,
            ),
        )
    return { prisma, delivery, callLists, audit, realtime, created, send }
}

beforeEach(() => {
    jest.useFakeTimers({ now: DAY_NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    ;(loadWorkspaceRisk as jest.Mock)
        .mockReset()
        .mockResolvedValue([{ userId: 's1', risk: { reason: 'absent', signals: ['absent'] } }])
})
afterEach(() => jest.useRealTimers())

describe('SendClubMessageHandler — who may send what', () => {
    it('refuses a student (no coaching role) and writes nothing', async () => {
        const { send, prisma } = make()
        await expect(send(MEMBER, {})).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.clubMessage.create).not.toHaveBeenCalled()
    })

    it.each([
        ['RENEW', { segment: 'RENEW' }],
        ['UNPAID', { segment: 'UNPAID' }],
        ['a service message', { isService: true }],
    ])('refuses a coach %s (the sport-lead tier)', async (_, payload) => {
        const { send, prisma } = make()
        await expect(send(COACH, payload)).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.clubMessage.create).not.toHaveBeenCalled()
    })

    it("refuses a coach another coach's group", async () => {
        const { send, prisma } = make()
        await expect(send(COACH, { segment: 'GROUPS', groupIds: ['other'] })).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        expect(prisma.clubMessage.create).not.toHaveBeenCalled()
    })

    it('lets a coach write to an own group, scoped to own groups', async () => {
        const { send, created, delivery } = make()
        const res = await send(COACH, { segment: 'GROUPS', groupIds: ['own'] })
        expect(created[0]).toMatchObject({ segment: 'GROUPS', groupIds: ['own'], authorId: 'coach' })
        expect(delivery.deliver.mock.calls[0][2].scope).toEqual({ groupIds: ['own'] })
        expect(res.audienceLabel).toBe('Группы: Группа own')
    })

    it('a coach writing to "all" reaches only the students of own groups', async () => {
        const { send, delivery } = make()
        await send(COACH, { segment: 'ALL' })
        expect(delivery.deliver.mock.calls[0][2].scope).toEqual({ groupIds: ['own'] })
    })

    it('refuses a direction manager another direction, lets them write to their own', async () => {
        const setup = { coachGroups: [], managedDirections: ['bjj'], groupDirection: { own: 'bjj' } }
        const refused = make(setup)
        await expect(refused.send(COACH, { segment: 'DIRECTION', directionId: 'judo' })).rejects.toBeInstanceOf(
            ForbiddenError,
        )
        const allowed = make(setup)
        await allowed.send(COACH, { segment: 'DIRECTION', directionId: 'bjj' })
        expect(allowed.created[0]).toMatchObject({ segment: 'DIRECTION', directionId: 'bjj' })
        // Their scope: every group of the directions they run.
        expect(allowed.delivery.deliver.mock.calls[0][2].scope).toEqual({ groupIds: ['own'] })
    })

    it('refuses a plain coach any direction', async () => {
        const { send } = make()
        await expect(send(COACH, { segment: 'DIRECTION', directionId: 'bjj' })).rejects.toBeInstanceOf(
            ForbiddenError,
        )
    })

    it('lets the owner (no member row) send a service message to «Продлить», club-wide', async () => {
        const { send, created, delivery } = make()
        await send(OWNER, { segment: 'RENEW', isService: true })
        expect(created[0]).toMatchObject({ segment: 'RENEW', isService: true, authorId: 'owner' })
        expect(delivery.deliver.mock.calls[0][2].scope).toEqual({ groupIds: null })
    })

    it.each([ADMIN, HEAD_COACH])('lets $roleName use «Не оплатили»', async (who) => {
        const { send, created } = make()
        await send(who, { segment: 'UNPAID' })
        expect(created[0]).toMatchObject({ segment: 'UNPAID' })
    })
})

describe('SendClubMessageHandler — not found', () => {
    it('404s a group of another club, even for a sport lead', async () => {
        const { send, prisma } = make()
        await expect(send(ADMIN, { segment: 'GROUPS', groupIds: ['own', 'foreign'] })).rejects.toBeInstanceOf(
            NotFoundError,
        )
        expect(prisma.clubMessage.create).not.toHaveBeenCalled()
    })

    it('404s a direction of another club', async () => {
        const { send } = make()
        await expect(send(ADMIN, { segment: 'DIRECTION', directionId: 'foreign' })).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('404s a named student outside the scope (as if they did not exist)', async () => {
        const { send, prisma } = make({ membersFound: 1 })
        await expect(send(COACH, { segment: 'MEMBERS', memberIds: ['s1', 's9'] })).rejects.toBeInstanceOf(
            NotFoundError,
        )
        const where = prisma.workspaceMember.count.mock.calls[0][0].where
        expect(where.AND[1]).toEqual({ userId: { in: ['s1', 's9'] } })
        expect(where.AND[2]).toEqual({ user: { groupMemberships: { some: { groupId: { in: ['own'] } } } } })
    })
})

describe('SendClubMessageHandler — when and how', () => {
    it('sends now: audited as written, then delivered inline; the response carries the counters', async () => {
        const { send, delivery, audit } = make()
        const res = await send(ADMIN, { segment: 'ALL' })
        expect(delivery.deliver).toHaveBeenCalledWith('m1', DAY_NOW, expect.objectContaining({ scope: { groupIds: null } }))
        expect(res).toMatchObject({ status: 'SENT', recipientCount: 7, pushCount: 5, authorName: 'Анна Петрова' })
        expect(audit.record).toHaveBeenCalledWith({
            action: 'message.send',
            targetType: 'clubMessage',
            targetId: 'm1',
            workspaceId: 'w1',
            actorId: 'adm',
            metadata: {
                segment: 'ALL',
                isDirect: false,
                isService: false,
                urgent: false,
                withEmail: false,
                sendAt: DAY_NOW.toISOString(),
            },
        })
        // A failure while sending still leaves the audit row.
        expect(audit.record.mock.invocationCallOrder[0]).toBeLessThan(delivery.deliver.mock.invocationCallOrder[0])
    })

    it('the audit row stays when delivery fails', async () => {
        const { send, delivery, audit } = make()
        delivery.deliver.mockRejectedValueOnce(new Error('redis down'))
        await expect(send(ADMIN, {})).rejects.toThrow('redis down')
        expect(audit.record).toHaveBeenCalledTimes(1)
    })

    it('counts the limits and inserts under the club advisory lock, in one transaction', async () => {
        const { send, prisma } = make()
        await send(ADMIN, {})
        const p = prisma as typeof prisma & { $transaction: jest.Mock }
        expect(p.$transaction).toHaveBeenCalledTimes(1)
        expect(prisma.$executeRaw.mock.calls[0][1]).toBe('club-messages:w1')
        expect(prisma.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
            prisma.clubMessage.findMany.mock.invocationCallOrder[0],
        )
        expect(prisma.clubMessage.findMany.mock.invocationCallOrder[0]).toBeLessThan(
            prisma.clubMessage.create.mock.invocationCallOrder[0],
        )
    })

    it('at 23:00 club time holds a message until 09:00 (SCHEDULED, not delivered)', async () => {
        jest.setSystemTime(NIGHT_NOW)
        const { send, delivery, created, realtime, prisma } = make()
        const res = await send(ADMIN, { segment: 'ALL' })
        expect(created[0].sendAt).toEqual(new Date('2026-11-27T02:00:00Z'))
        expect(delivery.deliver).not.toHaveBeenCalled()
        expect(res.status).toBe('SCHEDULED')
        expect(realtime.invalidateCoalesced).toHaveBeenCalledWith('w1', ['messages'])
        // Counted against the day it goes out on (the 27th, club time).
        expect(prisma.clubMessage.findMany.mock.calls[0][0].where.sendAt).toEqual({
            gte: new Date('2026-11-26T17:00:00Z'),
            lt: new Date('2026-11-27T17:00:00Z'),
        })
    })

    it('refuses «Срочно» with «Отправить позже»: urgent means now', async () => {
        const { send, prisma } = make()
        await expect(send(ADMIN, { urgent: true, sendAt: '2026-11-27T08:00:00.000Z' })).rejects.toThrow(
            'Срочное сообщение уходит сразу',
        )
        expect(prisma.clubMessage.create).not.toHaveBeenCalled()
    })

    it('an urgent one goes at once even at night', async () => {
        jest.setSystemTime(NIGHT_NOW)
        const { send, delivery, created } = make()
        await send(COACH, { segment: 'ALL', urgent: true })
        expect(created[0]).toMatchObject({ urgent: true, sendAt: NIGHT_NOW })
        expect(delivery.deliver).toHaveBeenCalled()
    })

    it('«Отправить позже» keeps the requested time; a past one means now', async () => {
        const later = make()
        const at = new Date('2026-11-28T08:00:00Z') // 15:00 Tomsk
        await later.send(ADMIN, { sendAt: at.toISOString() })
        expect(later.created[0].sendAt).toEqual(at)
        expect(later.delivery.deliver).not.toHaveBeenCalled()
        const past = make()
        await past.send(ADMIN, { sendAt: '2026-11-20T08:00:00.000Z' })
        expect(past.created[0].sendAt).toEqual(DAY_NOW)
        expect(past.delivery.deliver).toHaveBeenCalled()
    })

    it('refuses scheduling more than 30 days ahead', async () => {
        const { send } = make()
        await expect(send(ADMIN, { sendAt: '2027-01-10T08:00:00.000Z' })).rejects.toBeInstanceOf(BadRequestError)
    })

    it('refuses e-mail while the club switch is off; stores it when on', async () => {
        const off = make({ messagesEmailEnabled: false })
        await expect(off.send(ADMIN, { withEmail: true })).rejects.toThrow(
            'E-mail для сообщений выключен в настройках клуба',
        )
        expect(off.prisma.clubMessage.create).not.toHaveBeenCalled()
        const on = make({ messagesEmailEnabled: true })
        await on.send(ADMIN, { withEmail: true })
        expect(on.created[0].withEmail).toBe(true)
    })

    it('one named student is a direct message; several are not', async () => {
        const one = make()
        await one.send(COACH, { segment: 'MEMBERS', memberIds: ['s1'] })
        expect(one.created[0]).toMatchObject({ isDirect: true, memberIds: ['s1'] })
        const two = make({ membersFound: 2 })
        await two.send(COACH, { segment: 'MEMBERS', memberIds: ['s1', 's2'] })
        expect(two.created[0].isDirect).toBe(false)
    })
})

describe('SendClubMessageHandler — limits', () => {
    const many = (n: number, over: Partial<{ authorId: string; isDirect: boolean; urgent: boolean }> = {}) =>
        Array.from({ length: n }, () => ({ authorId: 'x', isDirect: false, urgent: false, ...over }))

    it('refuses the 11th broadcast of the club today', async () => {
        const { send, prisma } = make({ today: many(10) })
        await expect(send(ADMIN, {})).rejects.toThrow('Сегодня клуб уже отправил 10 рассылок — следующая завтра')
        expect(prisma.clubMessage.create).not.toHaveBeenCalled()
    })

    it("refuses a coach's 4th broadcast, not a sport lead's", async () => {
        const today = many(3, { authorId: 'coach' })
        await expect(make({ today }).send(COACH, {})).rejects.toThrow('Сегодня вы уже отправили 3 рассылки')
        const lead = make({ today: many(3, { authorId: 'hc' }) })
        await lead.send(HEAD_COACH, {})
        expect(lead.prisma.clubMessage.create).toHaveBeenCalled()
    })

    it('a direct message is outside the broadcast limits, within its own 50', async () => {
        const ok = make({ today: many(10) })
        await ok.send(COACH, { segment: 'MEMBERS', memberIds: ['s1'] })
        expect(ok.prisma.clubMessage.create).toHaveBeenCalled()
        const full = make({ today: many(50, { authorId: 'coach', isDirect: true }) })
        await expect(full.send(COACH, { segment: 'MEMBERS', memberIds: ['s1'] })).rejects.toThrow(
            'Сегодня вы уже отправили 50 личных сообщений',
        )
    })

    it('refuses the 3rd urgent message of a sender today', async () => {
        const { send } = make({ today: many(2, { authorId: 'adm', urgent: true }) })
        await expect(send(ADMIN, { urgent: true })).rejects.toThrow('Сегодня вы уже отправили 2 срочных сообщения')
    })
})

describe('SendClubMessageHandler — written from «Кому позвонить»', () => {
    it('logs the contact like «Связались» with the message, keeps its id there, drops the call list cache', async () => {
        const { send, prisma, callLists, created } = make()
        await send(COACH, { segment: 'MEMBERS', memberIds: ['s1'], logContact: true, title: 'Как вы?' })
        expect(prisma.memberRetentionContact.create).toHaveBeenCalledWith({
            data: {
                workspaceId: 'w1',
                userId: 's1',
                contactedById: 'coach',
                reason: 'absent',
                signals: ['absent'],
                note: 'Сообщение: Как вы?',
            },
            select: { id: true },
        })
        expect(created[0].contactId).toBe('c1')
        expect(callLists.invalidate).toHaveBeenCalledWith('w1')
        expect(callLists.invalidate.mock.invocationCallOrder[0]).toBeGreaterThan(
            prisma.clubMessage.create.mock.invocationCallOrder[0],
        )
    })

    it('writes no contact when a limit refuses the message', async () => {
        const { send, prisma, callLists } = make({
            today: Array.from({ length: 50 }, () => ({ authorId: 'coach', isDirect: true, urgent: false })),
        })
        await expect(
            send(COACH, { segment: 'MEMBERS', memberIds: ['s1'], logContact: true }),
        ).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.memberRetentionContact.create).not.toHaveBeenCalled()
        expect(callLists.invalidate).not.toHaveBeenCalled()
    })

    it('refuses logContact on anything but a direct message', async () => {
        const { send, prisma } = make({ membersFound: 2 })
        await expect(
            send(ADMIN, { segment: 'MEMBERS', memberIds: ['s1', 's2'], logContact: true }),
        ).rejects.toThrow('Связь засчитывается только за личное сообщение')
        expect(prisma.clubMessage.create).not.toHaveBeenCalled()
    })

    it("refuses logContact for someone not on the sender's open list (snoozed, or another coach's)", async () => {
        for (const id of ['s3', 's2']) {
            const { send, prisma } = make()
            await expect(send(COACH, { segment: 'MEMBERS', memberIds: [id], logContact: true })).rejects.toThrow(
                'Этого ученика нет в списке «Кому позвонить»',
            )
            expect(prisma.memberRetentionContact.create).not.toHaveBeenCalled()
        }
    })

    it('writes no contact without logContact', async () => {
        const { send, prisma, callLists } = make()
        await send(COACH, { segment: 'MEMBERS', memberIds: ['s1'] })
        expect(prisma.memberRetentionContact.create).not.toHaveBeenCalled()
        expect(callLists.invalidate).not.toHaveBeenCalled()
    })
})
