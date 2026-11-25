jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))

import { loadPayrollSessions, loadPayrollStaff } from './payroll-loader'

const WS = 'w1'
const START = new Date('2026-10-31T21:00:00Z')

describe('loadPayrollStaff (who was on staff during the month)', () => {
    const run = (current: unknown[], left: unknown[]) => {
        const db = {
            user: { findMany: jest.fn().mockResolvedValue(current) },
            auditEvent: { findMany: jest.fn().mockResolvedValue(left) },
        }
        return { db, out: loadPayrollStaff(db as never, { workspaceId: WS, ownerId: 'owner', start: START }) }
    }

    it('takes today’s staff whenever they joined and those who left since the month began', async () => {
        // Joined after the month (staff imported later): an explicit rate for it is meant.
        const { db, out } = run([{ id: 'owner' }, { id: 'early' }, { id: 'later' }], [{ targetId: 'gone' }, { targetId: null }])
        expect([...(await out)].sort()).toEqual(['early', 'gone', 'later', 'owner'])
        // Someone who left before the month began is not found: the journal is read from its start.
        expect(db.auditEvent.findMany.mock.calls[0][0].where).toEqual({
            workspaceId: WS,
            OR: [
                { action: { in: ['member.remove', 'member.leave'] } },
                { action: 'member.updateRole', metadata: { path: ['toRoleName'], equals: 'user' } },
            ],
            targetType: 'member',
            createdAt: { gte: START },
        })
    })
})

describe('loadPayrollSessions', () => {
    it('keeps the scheduled slot from the occurrence key when the slot was deleted', async () => {
        const row = (over: Record<string, unknown>) => ({
            id: 's',
            groupId: 'g1',
            slotId: null,
            occurrenceKey: 'slot:slot-gone:2026-11-03',
            sessionDate: new Date('2026-11-03T00:00:00Z'),
            startAt: new Date('2026-11-03T16:00:00Z'),
            timezone: 'Europe/Moscow',
            isPersonal: false,
            workspaceEventId: null,
            coachId: 'c',
            group: { name: 'Утро', coachId: 'c', coaches: [{ userId: 'c' }] },
            records: [],
            ...over,
        })
        const db = {
            attendanceSession: {
                findMany: jest.fn().mockResolvedValue([
                    row({}),
                    row({ id: 'live', slotId: 'slot-1', occurrenceKey: 'slot:slot-1:2026-11-03' }),
                    row({ id: 'adhoc', occurrenceKey: 'adhoc:g1:2026-11-03T19:00' }),
                ]),
            },
        }
        const sessions = await loadPayrollSessions(db as never, { workspaceId: WS, month: '2026-11', tz: 'Europe/Moscow' })
        expect(sessions.map((s) => [s.id, s.scheduledSlotId])).toEqual([
            ['s', 'slot-gone'],
            ['live', 'slot-1'],
            ['adhoc', null],
        ])
    })
})
