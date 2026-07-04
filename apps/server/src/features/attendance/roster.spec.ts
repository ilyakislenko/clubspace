import { buildRoster } from './roster'

const makePrisma = () => ({
    attendanceRecord: { findMany: jest.fn() },
    groupMember: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
})

describe('buildRoster — group session', () => {
    it('pre-populates group members with present flags and adds guests', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([
            { userId: 'm1', isGuest: false },
            { userId: 'g9', isGuest: true },
        ])
        p.groupMember.findMany.mockResolvedValue([
            { userId: 'm1', user: { firstname: 'Ann', lastname: null, email: 'a@x' } },
            { userId: 'm2', user: { firstname: null, lastname: null, email: 'm2@x' } },
        ])
        p.user.findMany.mockResolvedValue([
            { id: 'g9', firstname: 'Guest', lastname: null, email: 'g@x' },
        ])
        const out = await buildRoster(p as any, {
            id: 'sess1',
            groupId: 'grp',
            slotId: 's1',
            workspaceEventId: null,
        })
        expect(out.kind).toBe('scheduled')
        expect(out.roster).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ userId: 'm1', present: true, isGuest: false, displayName: 'Ann' }),
                expect.objectContaining({ userId: 'm2', present: false, isGuest: false, displayName: 'm2@x' }),
                expect.objectContaining({ userId: 'g9', present: true, isGuest: true, displayName: 'Guest' }),
            ]),
        )
    })
})

describe('buildRoster — event session', () => {
    it('returns marked attendees only with isGuest null', async () => {
        const p = makePrisma()
        p.attendanceRecord.findMany.mockResolvedValue([{ userId: 'a1', isGuest: null }])
        p.user.findMany.mockResolvedValue([
            { id: 'a1', firstname: 'Ivan', lastname: 'P', email: 'i@x' },
        ])
        const out = await buildRoster(p as any, {
            id: 'sess2',
            groupId: null,
            slotId: null,
            workspaceEventId: 'e1',
        })
        expect(out.kind).toBe('event')
        expect(p.groupMember.findMany).not.toHaveBeenCalled()
        expect(out.roster).toEqual([
            { userId: 'a1', displayName: 'Ivan P', present: true, isGuest: null },
        ])
    })
})
