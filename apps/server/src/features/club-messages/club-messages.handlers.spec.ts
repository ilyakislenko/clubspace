import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { CancelClubMessageFeature } from './cancel-club-message.feature'
import { CancelClubMessageHandler } from './cancel-club-message.handler'
import { GetClubMessageFeature } from './get-club-message.feature'
import { GetClubMessageHandler } from './get-club-message.handler'
import { ListClubMessageRecipientsFeature } from './list-club-message-recipients.feature'
import { ListClubMessageRecipientsHandler } from './list-club-message-recipients.handler'
import { ListClubMessagesFeature } from './list-club-messages.feature'
import { ListClubMessagesHandler } from './list-club-messages.handler'
import { loadAudienceLabels, type ClubMessageRow } from './schemas'

type Who = { userId: string; roleName: string | null }
const OWNER: Who = { userId: 'owner', roleName: null }
const ADMIN: Who = { userId: 'adm', roleName: 'admin' }
const HEAD_COACH: Who = { userId: 'hc', roleName: 'head_coach' }
const COACH: Who = { userId: 'coach', roleName: 'coach' }
const MEMBER: Who = { userId: 'm', roleName: 'user' }

const T = new Date('2026-11-20T10:00:00Z')

const row = (over: Partial<ClubMessageRow> & { authorId?: string } = {}) => ({
    id: 'm1',
    title: 'Сбор',
    body: 'Текст',
    authorName: 'Тренер',
    segment: 'ALL' as const,
    directionId: null,
    groupIds: [],
    memberIds: [],
    isDirect: false,
    isService: false,
    urgent: false,
    withEmail: false,
    status: 'SENT' as const,
    sendAt: T,
    sentAt: T,
    recipientCount: 10,
    pushCount: 8,
    emailCount: 0,
    readCount: 4,
    createdAt: T,
    ...over,
})

// Messages of the club; the coach wrote m1, the admin m2.
const MESSAGES = [
    { ...row({ id: 'm1' }), authorId: 'coach', workspaceId: 'w1' },
    { ...row({ id: 'm2', status: 'SCHEDULED', sentAt: null }), authorId: 'adm', workspaceId: 'w1' },
]

const matches = (m: (typeof MESSAGES)[number], where: Record<string, unknown>) =>
    (where.id === undefined || where.id === m.id) &&
    (where.authorId === undefined || where.authorId === m.authorId) &&
    (where.workspaceId === undefined || where.workspaceId === m.workspaceId)

const make = () => {
    const prisma = {
        workspace: {
            findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner', coachSeesAllGroups: true, type: 'GRAPPLING' }),
            findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: 'Asia/Tomsk' }),
        },
        clubMessage: {
            findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
                const m = MESSAGES.find((x) => matches(x, where))
                if (!m) return null
                const { authorId: _a, workspaceId: _w, ...rest } = m
                return rest
            }),
            findMany: jest.fn().mockResolvedValue([row({ id: 'm1' })]),
            count: jest.fn().mockResolvedValue(1),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            findUniqueOrThrow: jest
                .fn()
                .mockResolvedValue({ ...row({ id: 'm2', status: 'CANCELLED', sentAt: null }), contactId: null }),
        },
        clubMessageRecipient: {
            findMany: jest.fn().mockResolvedValue([]),
            count: jest.fn().mockResolvedValue(0),
        },
        groupMember: { findMany: jest.fn().mockResolvedValue([{ userId: 's1' }]) },
        group: { findMany: jest.fn().mockResolvedValue([]) },
        direction: { findMany: jest.fn().mockResolvedValue([]) },
        user: { findMany: jest.fn().mockResolvedValue([]) },
        memberRetentionContact: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    }
    const rbac = new RbacService(prisma as never)
    const audit = { record: jest.fn().mockResolvedValue(undefined) }
    const realtime = { invalidateCoalesced: jest.fn() }
    const callLists = { invalidate: jest.fn().mockResolvedValue(undefined) }
    return {
        prisma,
        audit,
        realtime,
        callLists,
        list: (who: Who, payload: Record<string, unknown> = {}) =>
            new ListClubMessagesHandler(prisma as never, rbac).execute(
                new ListClubMessagesFeature(payload as never, 'w1', who.userId, who.roleName, false),
            ),
        get: (who: Who, id: string) =>
            new GetClubMessageHandler(prisma as never, rbac).execute(
                new GetClubMessageFeature('w1', id, who.userId, who.roleName, false),
            ),
        recipients: (who: Who, id: string, payload: Record<string, unknown> = {}) =>
            new ListClubMessageRecipientsHandler(prisma as never, rbac).execute(
                new ListClubMessageRecipientsFeature(payload as never, 'w1', id, who.userId, who.roleName, false),
            ),
        cancel: (who: Who, id: string) =>
            new CancelClubMessageHandler(
                prisma as never,
                rbac,
                audit as never,
                realtime as never,
                callLists as never,
            ).execute(
                new CancelClubMessageFeature('w1', id, who.userId, who.roleName, false),
            ),
    }
}

describe('ListClubMessagesHandler', () => {
    it('refuses a student', async () => {
        await expect(make().list(MEMBER)).rejects.toBeInstanceOf(ForbiddenError)
    })

    it.each([OWNER, ADMIN, HEAD_COACH])('a sport lead ($roleName) sees every message of the club', async (who) => {
        const { list, prisma } = make()
        const res = await list(who)
        expect(prisma.clubMessage.findMany.mock.calls[0][0]).toMatchObject({
            where: { workspaceId: 'w1' },
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: 0,
            take: 50,
        })
        expect(res).toMatchObject({ total: 1, curPage: 1, perPage: 50, timezone: 'Asia/Tomsk' })
        expect(res.data[0]).toMatchObject({ id: 'm1', audienceLabel: 'Все ученики', recipientReadAt: null })
    })

    it('a coach sees only what they wrote, even with coachSeesAllGroups', async () => {
        const { list, prisma } = make()
        await list(COACH)
        expect(prisma.clubMessage.findMany.mock.calls[0][0].where).toEqual({ workspaceId: 'w1', authorId: 'coach' })
    })

    it("the member card: messages a student received, with when they opened each; status and paging", async () => {
        const { list, prisma } = make()
        prisma.clubMessageRecipient.findMany.mockResolvedValue([{ messageId: 'm1', readAt: T }])
        const res = await list(ADMIN, { userId: 's1', status: 'SENT', curPage: 2, perPage: 10 })
        expect(prisma.clubMessage.findMany.mock.calls[0][0]).toMatchObject({
            where: { workspaceId: 'w1', status: 'SENT', recipients: { some: { userId: 's1' } } },
            skip: 10,
            take: 10,
        })
        expect(prisma.clubMessageRecipient.findMany.mock.calls[0][0].where).toEqual({
            userId: 's1',
            messageId: { in: ['m1'] },
        })
        expect(res.data[0].recipientReadAt).toBe(T.toISOString())
    })
})

describe('GetClubMessageHandler', () => {
    it("404s another author's message for a coach (never 403: the id says nothing)", async () => {
        await expect(make().get(COACH, 'm2')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('404s an unknown id', async () => {
        await expect(make().get(ADMIN, 'nope')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('a coach opens their own; a head coach any', async () => {
        expect((await make().get(COACH, 'm1')).id).toBe('m1')
        expect((await make().get(HEAD_COACH, 'm2')).status).toBe('SCHEDULED')
    })

    it('refuses a student', async () => {
        await expect(make().get(MEMBER, 'm1')).rejects.toBeInstanceOf(ForbiddenError)
    })
})

describe('ListClubMessageRecipientsHandler', () => {
    const RECIPIENT = {
        userId: 'kid',
        pushSkip: null,
        emailedAt: null,
        readAt: T,
        user: {
            firstname: 'Миша',
            lastname: 'Иванов',
            email: null,
            dependentOf: [
                { consentAt: T, guardian: { firstname: 'Анна', lastname: 'Иванова', email: 'a@x.io' } },
                { consentAt: null, guardian: { firstname: 'Пётр', lastname: 'Иванов', email: 'p@x.io' } },
            ],
        },
    }

    it('refuses a student; 404s a message the viewer cannot see', async () => {
        await expect(make().recipients(MEMBER, 'm1')).rejects.toBeInstanceOf(ForbiddenError)
        await expect(make().recipients(COACH, 'm2')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('a sport lead sees every recipient, with the confirmed guardians of a child', async () => {
        const { recipients, prisma } = make()
        prisma.clubMessageRecipient.findMany.mockResolvedValue([RECIPIENT])
        prisma.clubMessageRecipient.count.mockResolvedValue(1)
        const res = await recipients(OWNER, 'm2')
        expect(prisma.clubMessageRecipient.findMany.mock.calls[0][0].where).toEqual({ messageId: 'm2' })
        expect(prisma.groupMember.findMany).not.toHaveBeenCalled()
        expect(res).toEqual({
            data: [
                {
                    userId: 'kid',
                    name: 'Миша Иванов',
                    isDependent: true,
                    guardianNames: ['Анна Иванова'],
                    pushSkip: null,
                    emailedAt: null,
                    readAt: T.toISOString(),
                },
            ],
            total: 1,
            curPage: 1,
            perPage: 50,
        })
    })

    it('a coach sees only recipients still in own groups; the read filter narrows', async () => {
        const { recipients, prisma } = make()
        await recipients(COACH, 'm1', { read: false })
        expect(prisma.clubMessageRecipient.findMany.mock.calls[0][0].where).toEqual({
            messageId: 'm1',
            userId: { in: ['s1'] },
            readAt: null,
        })
        await recipients(COACH, 'm1', { read: true })
        expect(prisma.clubMessageRecipient.count.mock.calls[1][0].where.readAt).toEqual({ not: null })
    })
})

describe('CancelClubMessageHandler', () => {
    it('refuses a student', async () => {
        const { cancel, prisma } = make()
        await expect(cancel(MEMBER, 'm2')).rejects.toBeInstanceOf(ForbiddenError)
        expect(prisma.clubMessage.updateMany).not.toHaveBeenCalled()
    })

    it("404s another author's message for a coach", async () => {
        const { cancel, prisma } = make()
        await expect(cancel(COACH, 'm2')).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.clubMessage.updateMany).not.toHaveBeenCalled()
    })

    it('refuses one already sent (or cancelled): the status flip found nothing', async () => {
        const { cancel, prisma, audit } = make()
        prisma.clubMessage.updateMany.mockResolvedValue({ count: 0 })
        await expect(cancel(COACH, 'm1')).rejects.toBeInstanceOf(BadRequestError)
        expect(audit.record).not.toHaveBeenCalled()
    })

    it('the owner cancels a scheduled message: status flip guarded by SCHEDULED, audited, lists refetch', async () => {
        const { cancel, prisma, audit, realtime } = make()
        const res = await cancel(OWNER, 'm2')
        expect(prisma.clubMessage.updateMany).toHaveBeenCalledWith({
            where: { id: 'm2', status: 'SCHEDULED' },
            data: { status: 'CANCELLED' },
        })
        expect(res.status).toBe('CANCELLED')
        expect(audit.record).toHaveBeenCalledWith({
            action: 'message.cancel',
            targetType: 'clubMessage',
            targetId: 'm2',
            workspaceId: 'w1',
            actorId: 'owner',
            metadata: { segment: 'ALL', isDirect: false, sendAt: T.toISOString() },
        })
        expect(realtime.invalidateCoalesced).toHaveBeenCalledWith('w1', ['messages'])
        // No «Связались» was logged with it: nothing to take back.
        expect(prisma.memberRetentionContact.deleteMany).not.toHaveBeenCalled()
    })

    it('takes back the «Связались» a cancelled direct message logged; the member is back on the call list', async () => {
        const { cancel, prisma, callLists } = make()
        prisma.clubMessage.findUniqueOrThrow.mockResolvedValue({
            ...row({ id: 'm2', status: 'CANCELLED', sentAt: null, isDirect: true }),
            contactId: 'c1',
        })
        await cancel(ADMIN, 'm2')
        expect(prisma.memberRetentionContact.deleteMany).toHaveBeenCalledWith({
            where: { id: 'c1', workspaceId: 'w1' },
        })
        expect(callLists.invalidate).toHaveBeenCalledWith('w1')
    })

    it('a refused cancel takes nothing back', async () => {
        const { cancel, prisma } = make()
        prisma.clubMessage.updateMany.mockResolvedValue({ count: 0 })
        await expect(cancel(ADMIN, 'm2')).rejects.toBeInstanceOf(BadRequestError)
        expect(prisma.memberRetentionContact.deleteMany).not.toHaveBeenCalled()
    })
})

describe('loadAudienceLabels', () => {
    it('names groups, the direction, up to two people and the computed segments', async () => {
        const prisma = {
            group: { findMany: jest.fn().mockResolvedValue([{ id: 'g1', name: 'Дети 7–9' }, { id: 'g2', name: 'Взрослые утро' }]) },
            direction: { findMany: jest.fn().mockResolvedValue([{ id: 'd1', name: 'BJJ' }]) },
            user: {
                findMany: jest.fn().mockResolvedValue([
                    { id: 'u1', firstname: 'Иван', lastname: 'Петров', email: null },
                    { id: 'u2', firstname: 'Ольга', lastname: 'Смирнова', email: null },
                ]),
            },
        }
        const rows = [
            row({ id: 'a', segment: 'GROUPS', groupIds: ['g1', 'g2', 'gone'] }),
            row({ id: 'b', segment: 'DIRECTION', directionId: 'd1' }),
            row({ id: 'c', segment: 'MEMBERS', memberIds: ['u1'] }),
            row({ id: 'd', segment: 'MEMBERS', memberIds: ['u1', 'u2', 'u3', 'u4'] }),
            row({ id: 'e', segment: 'RENEW' }),
            row({ id: 'f', segment: 'GROUPS', groupIds: ['gone'] }),
            row({ id: 'g', segment: 'DIRECTION', directionId: 'deleted' }),
            row({ id: 'h', segment: 'MEMBERS', memberIds: ['gone'] }),
        ]
        const labels = await loadAudienceLabels(prisma as never, 'w1', rows)
        expect(Object.fromEntries(labels)).toEqual({
            a: 'Группы: Дети 7–9, Взрослые утро',
            b: 'Направление: BJJ',
            c: 'Иван Петров',
            d: 'Иван Петров, Ольга Смирнова и ещё 2',
            e: 'Продлить',
            f: 'Группы',
            g: 'Направление',
            h: 'Ученики',
        })
        expect(prisma.group.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['g1', 'g2', 'gone'] }, workspaceId: 'w1' })
    })

    it('reads nothing for rows without names', async () => {
        const prisma = { group: { findMany: jest.fn() }, direction: { findMany: jest.fn() }, user: { findMany: jest.fn() } }
        await loadAudienceLabels(prisma as never, 'w1', [row({ segment: 'UNPAID' })])
        expect(prisma.group.findMany).not.toHaveBeenCalled()
        expect(prisma.user.findMany).not.toHaveBeenCalled()
    })
})
