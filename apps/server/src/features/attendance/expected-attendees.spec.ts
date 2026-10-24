import { loadExpectedAttendees } from './expected-attendees'

const makePrisma = () => ({
    dropInBooking: { findMany: jest.fn().mockResolvedValue([]) },
})

const session = {
    id: 'sess1',
    workspaceId: 'w1',
    groupId: 'grp',
    slotId: 's1',
    occurrenceKey: 'slot:s1:2026-10-31',
}

describe('loadExpectedAttendees', () => {
    it('maps bookings with present flags, scoped to the occurrence and other groups', async () => {
        const p = makePrisma()
        p.dropInBooking.findMany.mockResolvedValue([
            { userId: 'u1', user: { firstname: 'Ann', lastname: 'K', email: 'a@x' } },
            { userId: 'u2', user: { firstname: null, lastname: null, email: 'b@x' } },
        ])
        const out = await loadExpectedAttendees(p as any, session, new Set(['u2']))
        expect(out).toEqual([
            { userId: 'u1', displayName: 'Ann K', present: false, source: 'booking' },
            { userId: 'u2', displayName: 'b@x', present: true, source: 'booking' },
        ])
        const args = p.dropInBooking.findMany.mock.calls[0][0]
        expect(args.where).toEqual({
            workspaceId: 'w1',
            occurrenceKey: 'slot:s1:2026-10-31',
            user: {
                groupMemberships: { none: { groupId: 'grp' } },
                workspaceMemberships: {
                    some: { workspaceId: 'w1', status: 'ACTIVE' },
                },
            },
        })
        expect(args.orderBy).toEqual({ createdAt: 'asc' })
    })

    it('returns [] without querying for a session with no slot', async () => {
        const p = makePrisma()
        const out = await loadExpectedAttendees(
            p as any,
            { ...session, slotId: null, occurrenceKey: 'adhoc:grp:x' },
            new Set(),
        )
        expect(out).toEqual([])
        expect(p.dropInBooking.findMany).not.toHaveBeenCalled()
    })
})
