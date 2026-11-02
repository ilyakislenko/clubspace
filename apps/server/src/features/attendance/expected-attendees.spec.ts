import { loadExpectedAttendees } from './expected-attendees'

const makePrisma = () => ({
    dropInBooking: { findMany: jest.fn().mockResolvedValue([]) },
    classBooking: { findMany: jest.fn().mockResolvedValue([]) },
    personalTrainingRequest: { findUnique: jest.fn().mockResolvedValue(null) },
    eventRegistration: { findMany: jest.fn().mockResolvedValue([]) },
})

const session = {
    id: 'sess1',
    workspaceId: 'w1',
    groupId: 'grp',
    slotId: 's1',
    occurrenceKey: 'slot:s1:2026-10-31',
    workspaceEventId: null,
    isPersonal: false,
}

// buildRoster fills these in one batch for every row (roster.spec.ts).
const unfilled = {
    frozenUntil: null,
    classesLeft: null,
    abonement: null,
    abonementOptions: [],
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
            { userId: 'u1', displayName: 'Ann K', present: false, source: 'booking', ...unfilled },
            { userId: 'u2', displayName: 'b@x', present: true, source: 'booking', ...unfilled },
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
        // No per-booking abonement lookup: the roster batches it.
        expect(args.select).toEqual({
            userId: true,
            user: { select: { firstname: true, lastname: true, email: true } },
        })
    })

    it('returns the one member of a personal session, without querying bookings', async () => {
        const p = makePrisma()
        p.personalTrainingRequest.findUnique.mockResolvedValue({
            memberId: 'm1',
            member: { firstname: 'Ann', lastname: 'K', email: 'a@x' },
        })
        const personal = {
            ...session,
            id: 'sess9',
            slotId: null,
            groupId: null,
            occurrenceKey: 'personal:r1',
            isPersonal: true,
        }
        const out = await loadExpectedAttendees(p as any, personal, new Set(['m1']))
        expect(out).toEqual([
            {
                userId: 'm1',
                displayName: 'Ann K',
                present: true,
                source: 'personal',
                ...unfilled,
            },
        ])
        expect(p.personalTrainingRequest.findUnique.mock.calls[0][0].where).toEqual({
            sessionId: 'sess9',
        })
        expect(p.dropInBooking.findMany).not.toHaveBeenCalled()
    })

    it('returns [] for a personal session whose request is gone', async () => {
        const p = makePrisma()
        const out = await loadExpectedAttendees(
            p as any,
            { ...session, slotId: null, isPersonal: true },
            new Set(),
        )
        expect(out).toEqual([])
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

    it('lists the members holding a place in an event with registration', async () => {
        const p = makePrisma()
        p.eventRegistration.findMany.mockResolvedValue([
            { userId: 'm1', user: { firstname: 'Аня', lastname: null, email: 'a@x' } },
        ])
        const out = await loadExpectedAttendees(
            p as any,
            {
                ...session,
                groupId: null,
                slotId: null,
                occurrenceKey: 'event:e1',
                workspaceEventId: 'e1',
            },
            new Set(),
        )
        expect(out).toEqual([
            { userId: 'm1', displayName: 'Аня', present: false, source: 'booking', ...unfilled },
        ])
        expect(p.eventRegistration.findMany.mock.calls[0][0].where).toEqual({
            eventId: 'e1',
            status: 'BOOKED',
        })
        expect(p.dropInBooking.findMany).not.toHaveBeenCalled()
    })
})
