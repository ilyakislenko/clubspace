import { NotFoundError } from '../../shared/errors/shared.errors'
import { GetMyClubMessageFeature } from './get-my-club-message.feature'
import { GetMyClubMessageHandler } from './get-my-club-message.handler'
import { ListMyClubMessagesFeature } from './list-my-club-messages.feature'
import { ListMyClubMessagesHandler } from './list-my-club-messages.handler'
import { MarkClubMessageReadFeature } from './mark-club-message-read.feature'
import { MarkClubMessageReadHandler } from './mark-club-message-read.handler'

const SENT = new Date('2026-11-20T10:00:00Z')
const READ = new Date('2026-11-21T08:00:00Z')

const recipient = (readAt: Date | null = null, id = 'm1') => ({
    readAt,
    message: { id, title: 'Сбор', body: 'Текст', authorName: 'Тренер', sentAt: SENT },
})

// Own copies: (userId, messageId) pairs this person received from club w1.
const make = (own: Record<string, Date | null> = { m1: null }) => {
    const state = { ...own }
    const tx = {
        clubMessageRecipient: {
            updateMany: jest.fn(async ({ where }: { where: { messageId: string; readAt: null } }) => {
                if (!(where.messageId in state) || state[where.messageId] !== null) return { count: 0 }
                state[where.messageId] = READ
                return { count: 1 }
            }),
        },
        clubMessage: { update: jest.fn().mockResolvedValue({}) },
    }
    const prisma = {
        workspace: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Клуб', logoKey: null }) },
        clubMessageRecipient: {
            findFirst: jest.fn(async ({ where }: { where: { userId: string; messageId: string } }) =>
                where.userId === 'kid' && where.messageId in state
                    ? recipient(state[where.messageId], where.messageId)
                    : null,
            ),
            findMany: jest.fn().mockResolvedValue([recipient(null, 'm2'), recipient(READ, 'm1')]),
            count: jest.fn(async ({ where }: { where: { readAt?: null } }) => ('readAt' in where ? 1 : 2)),
        },
        $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    }
    const files = { getPresignedGetUrl: jest.fn(), getDefaultBucketName: jest.fn() }
    const realtime = { invalidateCoalesced: jest.fn(), invalidateUsersInWorkspace: jest.fn() }
    return {
        prisma,
        tx,
        realtime,
        // The request acts for the child (a guardian with X-Act-As: kid).
        markRead: (userId: string, messageId: string) =>
            new MarkClubMessageReadHandler(prisma as never, files as never, realtime as never).execute(
                new MarkClubMessageReadFeature('w1', messageId, userId),
            ),
        get: (userId: string, messageId: string) =>
            new GetMyClubMessageHandler(prisma as never, files as never).execute(
                new GetMyClubMessageFeature('w1', messageId, userId),
            ),
        list: (userId: string, payload: Record<string, unknown> = {}) =>
            new ListMyClubMessagesHandler(prisma as never, files as never).execute(
                new ListMyClubMessagesFeature(payload as never, 'w1', userId),
            ),
    }
}

describe('MarkClubMessageReadHandler', () => {
    it("acting as a child marks the child's row: readAt and readCount in one transaction", async () => {
        const { markRead, tx, realtime } = make()
        const res = await markRead('kid', 'm1')
        expect(tx.clubMessageRecipient.updateMany).toHaveBeenCalledWith({
            where: { messageId: 'm1', userId: 'kid', readAt: null },
            data: { readAt: expect.any(Date) },
        })
        expect(tx.clubMessage.update).toHaveBeenCalledWith({
            where: { id: 'm1' },
            data: { readCount: { increment: 1 } },
        })
        expect(res).toEqual({
            id: 'm1',
            title: 'Сбор',
            body: 'Текст',
            authorName: 'Тренер',
            sentAt: SENT.toISOString(),
            readAt: READ.toISOString(),
            club: { name: 'Клуб', logoUrl: null },
        })
        expect(realtime.invalidateCoalesced).toHaveBeenCalledWith('w1', ['messages'])
        expect(realtime.invalidateUsersInWorkspace).toHaveBeenCalledWith(['kid'], 'w1', ['club-messages'])
    })

    it('is idempotent: a second open counts nothing and emits nothing', async () => {
        const { markRead, tx, realtime } = make({ m1: READ })
        const res = await markRead('kid', 'm1')
        expect(tx.clubMessage.update).not.toHaveBeenCalled()
        expect(realtime.invalidateCoalesced).not.toHaveBeenCalled()
        expect(res.readAt).toBe(READ.toISOString())
    })

    it("404s someone else's message (the guardian's own id is not the child's row) and writes nothing", async () => {
        const { markRead, prisma } = make()
        await expect(markRead('mom', 'm1')).rejects.toBeInstanceOf(NotFoundError)
        await expect(markRead('kid', 'other')).rejects.toBeInstanceOf(NotFoundError)
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('only sent messages of this club are «own»', async () => {
        const { markRead, prisma } = make()
        await markRead('kid', 'm1')
        expect(prisma.clubMessageRecipient.findFirst.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            userId: 'kid',
            message: { status: 'SENT' },
            messageId: 'm1',
        })
    })
})

describe('GetMyClubMessageHandler', () => {
    it('returns the own copy without marking it read', async () => {
        const { get, prisma } = make()
        expect((await get('kid', 'm1')).readAt).toBeNull()
        expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('404s a message the person did not receive', async () => {
        await expect(make().get('mom', 'm1')).rejects.toBeInstanceOf(NotFoundError)
    })
})

describe('ListMyClubMessagesHandler', () => {
    it("every sent message of the club the person received, newest first, with the unread count", async () => {
        const { list, prisma } = make()
        const res = await list('kid', { curPage: 2, perPage: 20 })
        expect(prisma.clubMessageRecipient.findMany.mock.calls[0][0]).toMatchObject({
            where: { workspaceId: 'w1', userId: 'kid', message: { status: 'SENT' } },
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: 20,
            take: 20,
        })
        expect(prisma.clubMessageRecipient.count.mock.calls[1][0].where).toEqual({
            workspaceId: 'w1',
            userId: 'kid',
            message: { status: 'SENT' },
            readAt: null,
        })
        expect(res).toMatchObject({ total: 2, unreadCount: 1, curPage: 2, perPage: 20 })
        expect(res.data.map((m) => [m.id, m.readAt])).toEqual([
            ['m2', null],
            ['m1', READ.toISOString()],
        ])
    })

    it('defaults to the first page of 50', async () => {
        const { list, prisma } = make()
        const res = await list('kid')
        expect(prisma.clubMessageRecipient.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 50 })
        expect(res.perPage).toBe(50)
    })
})
