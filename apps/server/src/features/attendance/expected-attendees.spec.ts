import { loadExpectedAttendees } from './expected-attendees'

const makePrisma = () => ({
    dropInBooking: { findMany: jest.fn().mockResolvedValue([]) },
    personalTrainingRequest: { findUnique: jest.fn().mockResolvedValue(null) },
})

const session = {
    id: 'sess1',
    workspaceId: 'w1',
    groupId: 'grp',
    slotId: 's1',
    occurrenceKey: 'slot:s1:2026-10-31',
    isPersonal: false,
}

describe('loadExpectedAttendees', () => {
    it('maps bookings with present flags, scoped to the occurrence and other groups', async () => {
        const p = makePrisma()
        p.dropInBooking.findMany.mockResolvedValue([
            { userId: 'u1', user: { firstname: 'Ann', lastname: 'K', email: 'a@x', workspaceMemberships: [] } },
            { userId: 'u2', user: { firstname: null, lastname: null, email: 'b@x', workspaceMemberships: [] } },
        ])
        const out = await loadExpectedAttendees(p as any, session, new Set(['u2']))
        expect(out).toEqual([
            { userId: 'u1', displayName: 'Ann K', present: false, source: 'booking', frozenUntil: null, classesLeft: null },
            { userId: 'u2', displayName: 'b@x', present: true, source: 'booking', frozenUntil: null, classesLeft: null },
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

    it('reports the guest\'s usable pack balance, null for none / unusable / time-only', async () => {
        const p = makePrisma()
        const user = (subscription: unknown) => ({
            firstname: 'A',
            lastname: null,
            email: 'a@x',
            workspaceMemberships: [{ subscription }],
        })
        const live = new Date('2099-01-01T00:00:00Z')
        p.dropInBooking.findMany.mockResolvedValue([
            { userId: 'u1', user: user({ status: 'ACTIVE', endDate: live, classesRemaining: 0 }) },
            { userId: 'u2', user: user({ status: 'ACTIVE', endDate: live, classesRemaining: 3 }) },
            { userId: 'u3', user: user({ status: 'ACTIVE', endDate: live, classesRemaining: null }) },
            { userId: 'u4', user: user({ status: 'ACTIVE', endDate: new Date('2020-01-01T00:00:00Z'), classesRemaining: 5 }) },
            { userId: 'u5', user: user(null) },
        ])
        const out = await loadExpectedAttendees(p as any, session, new Set())
        expect(out.map((e) => e.classesLeft)).toEqual([0, 3, null, null, null])
        expect(
            p.dropInBooking.findMany.mock.calls[0][0].select.user.select
                .workspaceMemberships.where,
        ).toEqual({ workspaceId: 'w1' })
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
                frozenUntil: null,
                classesLeft: null,
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
})
