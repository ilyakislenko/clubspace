import { memberOfDirectionWhere } from '../directions/direction-scope'
import { notAttendedWhere } from '../metrics/attendance'
import { studentWhere } from '../metrics/students'
import { owesPaymentWhere } from '../subscriptions/renewal-rules'
import {
    type MessageScope,
    scopeMemberWhere,
    type SegmentTarget,
    segmentMemberWhere,
} from './segment-where'

const NOW = new Date('2026-11-26T05:00:00Z')
const CLUB: MessageScope = { groupIds: null }
// A coach or direction manager: the groups they act on as their own.
const OWN: MessageScope = { groupIds: ['own1', 'own2'] }
const OWN_WHERE = { user: { groupMemberships: { some: { groupId: { in: ['own1', 'own2'] } } } } }
const BASE = studentWhere('w1', 'owner')

const target = (over: Partial<SegmentTarget>): SegmentTarget => ({
    segment: 'ALL',
    directionId: null,
    groupIds: [],
    memberIds: [],
    ...over,
})

const where = (t: Partial<SegmentTarget>, scope: MessageScope, resolvedIds?: string[]) =>
    segmentMemberWhere({
        workspaceId: 'w1',
        ownerId: 'owner',
        target: target(t),
        scope,
        now: NOW,
        resolvedIds,
    })

describe('scopeMemberWhere', () => {
    it('does not narrow a club-wide sender', () => {
        expect(scopeMemberWhere(CLUB)).toBeUndefined()
    })

    it('narrows a coach to the students of their own groups', () => {
        expect(scopeMemberWhere(OWN)).toEqual(OWN_WHERE)
    })

    it('a coach with no groups reaches nobody (an empty list, not no filter)', () => {
        expect(scopeMemberWhere({ groupIds: [] })).toEqual({
            user: { groupMemberships: { some: { groupId: { in: [] } } } },
        })
    })
})

describe('segmentMemberWhere', () => {
    // Each segment: its own condition from the function that defines it for
    // every other screen, AND-ed with the student base (and the scope). Every
    // row has four cells: a shorter one would hand jest's `done` to the test.
    const CONDITIONS: Array<[string, Partial<SegmentTarget>, unknown, string[] | undefined]> = [
        [
            'GROUPS',
            { segment: 'GROUPS', groupIds: ['g1', 'g2'] },
            { user: { groupMemberships: { some: { groupId: { in: ['g1', 'g2'] } } } } },
            undefined,
        ],
        ['DIRECTION', { segment: 'DIRECTION', directionId: 'd1' }, memberOfDirectionWhere('d1'), undefined],
        ['UNPAID', { segment: 'UNPAID' }, owesPaymentWhere, undefined],
        ['INACTIVE', { segment: 'INACTIVE' }, notAttendedWhere('w1', 'owner', NOW), undefined],
        ['MEMBERS', { segment: 'MEMBERS', memberIds: ['u1'] }, { userId: { in: ['u1'] } }, undefined],
        ['RENEW', { segment: 'RENEW' }, { userId: { in: ['r1', 'r2'] } }, ['r1', 'r2']],
        ['CALL_LIST', { segment: 'CALL_LIST' }, { userId: { in: ['c1'] } }, ['c1']],
    ]

    it('ALL, club-wide: the students of the club, nothing else', () => {
        expect(where({ segment: 'ALL' }, CLUB)).toEqual(BASE)
    })

    it('ALL, coach: the students of their own groups', () => {
        expect(where({ segment: 'ALL' }, OWN)).toEqual({ AND: [BASE, OWN_WHERE] })
    })

    it.each(CONDITIONS)('%s, club-wide: students ∩ the segment', (_, t, condition, resolved) => {
        expect(where(t, CLUB, resolved)).toEqual({ AND: [BASE, condition] })
    })

    it.each(CONDITIONS)(
        '%s, coach or direction manager: students ∩ the segment ∩ own groups',
        (_, t, condition, resolved) => {
            expect(where(t, OWN, resolved)).toEqual({ AND: [BASE, condition, OWN_WHERE] })
        },
    )

    it('RENEW / CALL_LIST without resolved ids match nobody', () => {
        for (const segment of ['RENEW', 'CALL_LIST'] as const) {
            expect(where({ segment }, CLUB)).toEqual({ AND: [BASE, { userId: { in: [] } }] })
        }
    })

    it('never lets a named member past the owner exclusion or the student role', () => {
        const w = where({ segment: 'MEMBERS', memberIds: ['owner'] }, CLUB) as { AND: unknown[] }
        expect(w.AND[0]).toEqual({
            workspaceId: 'w1',
            status: 'ACTIVE',
            role: { name: 'user' },
            userId: { not: 'owner' },
        })
    })
})
