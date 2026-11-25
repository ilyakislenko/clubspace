import { BadRequestError } from '../../shared/errors/shared.errors'
import {
    assertWithinLimits,
    type DayCounts,
    limitRefusal,
    limitsLeft,
    loadCappedRecipients,
    loadDayCounts,
    lockClubMessages,
} from './limits'

const counts = (over: Partial<DayCounts> = {}): DayCounts => ({
    clubBroadcasts: 0,
    senderBroadcasts: 0,
    senderDirect: 0,
    senderUrgent: 0,
    dayLabel: null,
    ...over,
})
const broadcast = { isDirect: false, urgent: false, senderIsLead: true }

describe('club message limits', () => {
    it('refuses the 11th broadcast of the club in a day, naming the limit', () => {
        expect(limitRefusal(counts({ clubBroadcasts: 9 }), broadcast)).toBeNull()
        expect(limitRefusal(counts({ clubBroadcasts: 10 }), broadcast)).toBe(
            'Сегодня клуб уже отправил 10 рассылок — следующая завтра',
        )
        expect(() => assertWithinLimits(counts({ clubBroadcasts: 10 }), broadcast)).toThrow(
            BadRequestError,
        )
    })

    it('holds a coach or direction manager to 3 broadcasts, a sport lead to none of their own', () => {
        const coach = { ...broadcast, senderIsLead: false }
        expect(limitRefusal(counts({ senderBroadcasts: 2, clubBroadcasts: 2 }), coach)).toBeNull()
        expect(limitRefusal(counts({ senderBroadcasts: 3, clubBroadcasts: 3 }), coach)).toBe(
            'Сегодня вы уже отправили 3 рассылки — следующая завтра',
        )
        expect(limitRefusal(counts({ senderBroadcasts: 3, clubBroadcasts: 3 }), broadcast)).toBeNull()
        expect(limitsLeft(counts({ senderBroadcasts: 1 }), false).senderLeft).toBe(2)
        expect(limitsLeft(counts({ senderBroadcasts: 1 }), true).senderLeft).toBeNull()
    })

    it('counts direct messages apart: 50 per sender, the club limit does not apply', () => {
        const direct = { isDirect: true, urgent: false, senderIsLead: false }
        expect(limitRefusal(counts({ clubBroadcasts: 10, senderBroadcasts: 3, senderDirect: 49 }), direct)).toBeNull()
        expect(limitRefusal(counts({ senderDirect: 50 }), direct)).toBe(
            'Сегодня вы уже отправили 50 личных сообщений — следующее завтра',
        )
    })

    it('allows 2 urgent messages per sender per day', () => {
        const urgent = { ...broadcast, urgent: true }
        expect(limitRefusal(counts({ senderUrgent: 1 }), urgent)).toBeNull()
        expect(limitRefusal(counts({ senderUrgent: 2 }), urgent)).toBe(
            'Сегодня вы уже отправили 2 срочных сообщения — следующее завтра',
        )
        expect(limitsLeft(counts({ senderUrgent: 2 }), true).urgentLeft).toBe(0)
    })

    it('counts the club-local day the message goes out on (cancelled ones excluded) in one query', async () => {
        const prisma = {
            clubMessage: {
                findMany: jest.fn().mockResolvedValue([
                    { authorId: 'me', isDirect: false, urgent: true },
                    { authorId: 'me', isDirect: true, urgent: false },
                    { authorId: 'other', isDirect: false, urgent: false },
                ]),
            },
        }
        // 00:30 in Tomsk (UTC+7) on the 27th: the day began at 17:00Z on the 26th.
        const now = new Date('2026-11-26T17:30:00Z')
        const result = await loadDayCounts(prisma as never, {
            workspaceId: 'w1',
            senderId: 'me',
            sendAt: now,
            now,
            timezone: 'Asia/Tomsk',
        })
        expect(result).toEqual({
            clubBroadcasts: 2,
            senderBroadcasts: 1,
            senderDirect: 1,
            senderUrgent: 1,
            dayLabel: null,
        })
        expect(prisma.clubMessage.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: 'w1',
            sendAt: { gte: new Date('2026-11-26T17:00:00Z'), lt: new Date('2026-11-27T17:00:00Z') },
            status: { not: 'CANCELLED' },
        })
    })

    it('a message scheduled for a later day counts against that day, and the refusal names it', async () => {
        const prisma = {
            clubMessage: {
                findMany: jest.fn().mockResolvedValue(
                    Array.from({ length: 10 }, () => ({ authorId: 'x', isDirect: false, urgent: false })),
                ),
            },
        }
        const result = await loadDayCounts(prisma as never, {
            workspaceId: 'w1',
            senderId: 'me',
            // 15:00 Tomsk on the 28th.
            sendAt: new Date('2026-11-28T08:00:00Z'),
            now: new Date('2026-11-26T05:00:00Z'),
            timezone: 'Asia/Tomsk',
        })
        expect(prisma.clubMessage.findMany.mock.calls[0][0].where.sendAt).toEqual({
            gte: new Date('2026-11-27T17:00:00Z'),
            lt: new Date('2026-11-28T17:00:00Z'),
        })
        expect(result.dayLabel).toBe('28 ноября')
        expect(limitRefusal(result, broadcast)).toBe('На 28 ноября у клуба уже 10 рассылок — выберите другой день')
        expect(limitRefusal({ ...result, clubBroadcasts: 3, senderBroadcasts: 3 }, { ...broadcast, senderIsLead: false })).toBe(
            'На 28 ноября у вас уже 3 рассылки — выберите другой день',
        )
        expect(limitRefusal({ ...result, senderDirect: 50 }, { ...broadcast, isDirect: true })).toBe(
            'На 28 ноября у вас уже 50 личных сообщений — выберите другой день',
        )
    })

    it('a day with a DST change still ends at the next local midnight', async () => {
        const prisma = { clubMessage: { findMany: jest.fn().mockResolvedValue([]) } }
        // 2026-11-01 is the day New York falls back (25 h long).
        await loadDayCounts(prisma as never, {
            workspaceId: 'w1',
            senderId: 'me',
            sendAt: new Date('2026-11-01T16:00:00Z'),
            now: new Date('2026-11-01T16:00:00Z'),
            timezone: 'America/New_York',
        })
        expect(prisma.clubMessage.findMany.mock.calls[0][0].where.sendAt).toEqual({
            gte: new Date('2026-11-01T04:00:00Z'),
            lt: new Date('2026-11-02T05:00:00Z'),
        })
    })

    it("takes the club's transaction-scoped advisory lock", async () => {
        const tx = { $executeRaw: jest.fn().mockResolvedValue(1) }
        await lockClubMessages(tx as never, 'w1')
        expect(tx.$executeRaw.mock.calls[0][0].join('?')).toBe('SELECT pg_advisory_xact_lock(hashtext(?))')
        expect(tx.$executeRaw.mock.calls[0][1]).toBe('club-messages:w1')
    })

    it('caps a recipient after 3 broadcast pushes of the club today', async () => {
        const prisma = {
            clubMessageRecipient: {
                groupBy: jest.fn().mockResolvedValue([
                    { userId: 'a', _count: { _all: 3 } },
                    { userId: 'b', _count: { _all: 2 } },
                ]),
            },
        }
        const capped = await loadCappedRecipients(prisma as never, {
            workspaceId: 'w1',
            userIds: ['a', 'b', 'c'],
            now: new Date('2026-11-26T05:00:00Z'),
            timezone: 'Asia/Tomsk',
        })
        expect([...capped]).toEqual(['a'])
        expect(prisma.clubMessageRecipient.groupBy.mock.calls[0][0].where).toMatchObject({
            pushSkip: null,
            message: { isService: false, isDirect: false },
        })
        expect(await loadCappedRecipients(prisma as never, { workspaceId: 'w1', userIds: [], now: new Date(), timezone: 'UTC' })).toEqual(new Set())
    })
})
