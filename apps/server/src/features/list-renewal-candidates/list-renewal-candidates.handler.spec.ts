// Authorization is covered by the assert-admin-scope tests and the filter ids
// by analytics-scope's; stub both so these specs focus on the candidate
// selection, ordering and paging.
jest.mock('../../shared/access/assert-admin-scope', () => ({
    assertSportLead: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../domains/analytics/analytics-scope', () => ({
    ...jest.requireActual('../../domains/analytics/analytics-scope'),
    resolveAnalyticsScope: jest.fn(),
}));

import { studentWhere } from '../../domains/metrics/students';
import { assertSportLead } from '../../shared/access/assert-admin-scope';
import { ForbiddenError } from '../../shared/errors/shared.errors';
import { resolveAnalyticsScope } from '../../domains/analytics/analytics-scope';
import {
    ListRenewalCandidatesFeature,
    type ListRenewalCandidatesInput,
} from './list-renewal-candidates.feature';
import { ListRenewalCandidatesHandler } from './list-renewal-candidates.handler';

const CLUB = { groupIds: null, includeGroupless: true };
beforeEach(() => {
    (resolveAnalyticsScope as jest.Mock).mockResolvedValue({ scope: CLUB });
});

const DAY = 24 * 60 * 60 * 1000;

const BJJ = { id: 'd-bjj', name: 'БЖЖ', color: null, icon: null };
const THAI = { id: 'd-thai', name: 'Тайский бокс', color: null, icon: null };

const abonement = (o: {
    classesRemaining?: number | null;
    classesTotal?: number | null;
    pending?: boolean;
    status?: string;
    endDate?: Date | null;
    planName?: string;
    directions?: (typeof BJJ)[];
}) => ({
    classesRemaining: o.classesRemaining ?? null,
    classesTotal:
        o.classesTotal !== undefined
            ? o.classesTotal
            : o.classesRemaining == null
              ? null
              : 8,
    status: o.status ?? 'ACTIVE',
    startDate: o.pending ? null : new Date(Date.now() - 10 * DAY),
    endDate:
        o.endDate !== undefined
            ? o.endDate
            : o.pending
              ? null
              : new Date(Date.now() + 30 * DAY),
    plan: { id: 'p1', name: o.planName ?? 'Абонемент' },
    directions: (o.directions ?? []).map((direction) => ({ direction })),
});

// `classesRemaining` given → the member holds one current abonement (the
// pre-parallel fixture); `subscriptions` → exactly those rows.
const member = (o: {
    userId: string;
    classesRemaining?: number | null;
    classesTotal?: number | null;
    accessUntil?: Date | null;
    pending?: boolean;
    subscriptions?: ReturnType<typeof abonement>[];
}) => ({
    userId: o.userId,
    accessUntil: o.accessUntil ?? null,
    user: {
        firstname: 'F',
        lastname: 'L',
        email: `${o.userId}@x`,
        phone: null,
        dependentOf: [],
    },
    subscriptions:
        o.subscriptions ??
        (o.classesRemaining === undefined
            ? []
            : [
                  abonement({
                      classesRemaining: o.classesRemaining,
                      classesTotal: o.classesTotal,
                      pending: o.pending,
                  }),
              ]),
});

const prismaFor = (members: unknown[], autopays: unknown[] = [], abonements: unknown[] = []) => ({
    workspace: {
        findUnique: jest.fn().mockResolvedValue({ ownerId: 'owner', timezone: 'Europe/Moscow' }),
    },
    workspaceMember: { findMany: jest.fn().mockResolvedValue(members) },
    // Live autopay agreements and the abonements their next charge is read from.
    memberAutopay: { findMany: jest.fn().mockResolvedValue(autopays) },
    subscription: { findMany: jest.fn().mockResolvedValue(abonements) },
});

const run = (
    members: unknown[],
    prisma = prismaFor(members),
    payload: ListRenewalCandidatesInput = {},
) => {
    return new ListRenewalCandidatesHandler(
        prisma as never,
        {} as never,
    ).execute(
        new ListRenewalCandidatesFeature(payload, 'w1', 'admin', 'admin', false),
    );
};

describe('listRenewalCandidates', () => {
    it('refuses a non-admin (coach) before touching the roster', async () => {
        (assertSportLead as jest.Mock).mockRejectedValueOnce(
            new ForbiddenError({ message: 'nope' }),
        );
        const findMany = jest.fn();
        const handler = new ListRenewalCandidatesHandler(
            { workspaceMember: { findMany } } as never,
            {} as never,
        );
        await expect(
            handler.execute(
                new ListRenewalCandidatesFeature({}, 'w1', 'c1', 'coach', false),
            ),
        ).rejects.toThrow(ForbiddenError);
        expect(findMany).not.toHaveBeenCalled();
    });

    it('flags out-of-classes, low-classes, and expiring — skips healthy members', async () => {
        const soon = new Date(Date.now() + 3 * DAY);
        const { data } = await run([
            member({ userId: 'out', classesRemaining: 0 }),
            member({ userId: 'low', classesRemaining: 1 }),
            member({ userId: 'expiring', accessUntil: soon }), // time-only
            member({ userId: 'healthy', classesRemaining: 5 }),
            member({ userId: 'nosub' }), // no subscription, no access window
        ]);

        const byId = Object.fromEntries(data.map((c) => [c.userId, c.reason]));
        expect(byId).toEqual({
            out: 'out_of_classes',
            low: 'low_classes',
            expiring: 'access_expiring',
        });
    });

    it('does not call an abonement that awaits its first visit "expiring"', async () => {
        const soon = new Date(Date.now() + 3 * DAY);
        const { data } = await run([
            member({
                userId: 'pending',
                classesRemaining: null,
                pending: true,
                accessUntil: soon,
            }),
        ]);
        expect(data).toEqual([]);
    });

    it('orders out_of_classes → low_classes → access_expiring', async () => {
        const { data } = await run([
            member({
                userId: 'expiring',
                accessUntil: new Date(Date.now() + DAY),
            }),
            member({ userId: 'out', classesRemaining: 0 }),
            member({ userId: 'low', classesRemaining: 1 }),
        ]);
        expect(data.map((c) => c.userId)).toEqual(['out', 'low', 'expiring']);
    });

    it('treats a window that lapsed within 30 days as a candidate, not an older one', async () => {
        const { data } = await run([
            member({
                userId: 'lapsed',
                accessUntil: new Date(Date.now() - DAY),
            }),
            member({
                userId: 'gone',
                accessUntil: new Date(Date.now() - 31 * DAY),
            }),
        ]);
        expect(data.map((c) => [c.userId, c.reason])).toEqual([
            ['lapsed', 'access_expiring'],
        ]);
    });

    it('does not flag a healthy class-pack member with a far-off window', async () => {
        const { data } = await run([
            member({
                userId: 'fine',
                classesRemaining: 6,
                accessUntil: new Date(Date.now() + 60 * DAY),
            }),
        ]);
        expect(data).toHaveLength(0);
    });

    it('reads current plus recently ended abonements of the club’s students', async () => {
        const prisma = prismaFor([]);
        await run([], prisma);
        const args = prisma.workspaceMember.findMany.mock.calls[0][0];
        // The whole club: no narrowing after the student base.
        expect(args.where).toEqual({ AND: [studentWhere('w1', 'owner'), {}] });
        const or = args.select.subscriptions.where.OR;
        expect(or[0]).toEqual({
            NOT: { workspaceMemberId: null },
            status: 'ACTIVE',
            OR: [{ endDate: null }, { endDate: { gt: expect.any(Date) } }],
        });
        expect(or[1].status).toEqual({ in: ['ACTIVE', 'EXPIRED'] });
        expect(or[1].endDate.lte.getTime() - or[1].endDate.gt.getTime()).toBe(
            30 * DAY,
        );
    });

    it('shows the abonement that needs renewing (one current abonement)', async () => {
        const end = new Date(Date.now() + 2 * DAY);
        const { data } = await run([
            member({
                userId: 'u',
                accessUntil: end,
                subscriptions: [
                    abonement({
                        classesRemaining: 1,
                        classesTotal: 12,
                        endDate: end,
                        planName: 'БЖЖ 12',
                        directions: [BJJ],
                    }),
                ],
            }),
        ]);
        expect(data).toEqual([
            {
                userId: 'u',
                firstname: 'F',
                lastname: 'L',
                email: 'u@x',
                phone: null,
                guardians: [],
                reason: 'low_classes',
                classesRemaining: 1,
                classesTotal: 12,
                accessUntil: end.toISOString(),
                planId: 'p1',
                planName: 'БЖЖ 12',
                endDate: end.toISOString(),
                directions: [BJJ],
                autopay: null,
            },
        ]);
    });

    it('skips a member who already renewed the same scope ahead', async () => {
        const { data } = await run([
            member({
                userId: 'renewed',
                accessUntil: new Date(Date.now() + 60 * DAY),
                subscriptions: [
                    abonement({
                        classesRemaining: 0,
                        endDate: new Date(Date.now() + 2 * DAY),
                        directions: [BJJ],
                    }),
                    abonement({
                        classesRemaining: 12,
                        endDate: new Date(Date.now() + 60 * DAY),
                        directions: [BJJ],
                    }),
                ],
            }),
        ]);
        expect(data).toEqual([]);
    });

    it('still flags an ending abonement when the other current one has a different scope', async () => {
        const bjjEnd = new Date(Date.now() + 2 * DAY);
        const { data } = await run([
            member({
                userId: 'u',
                // The window follows the longer (Thai) abonement.
                accessUntil: new Date(Date.now() + 60 * DAY),
                subscriptions: [
                    abonement({
                        endDate: bjjEnd,
                        planName: 'БЖЖ месяц',
                        directions: [BJJ],
                    }),
                    abonement({
                        classesRemaining: 8,
                        endDate: new Date(Date.now() + 60 * DAY),
                        planName: 'Тайский 8',
                        directions: [THAI],
                    }),
                ],
            }),
        ]);
        expect(data).toHaveLength(1);
        expect(data[0]).toMatchObject({
            reason: 'access_expiring',
            planName: 'БЖЖ месяц',
            endDate: bjjEnd.toISOString(),
            classesRemaining: null,
            directions: [BJJ],
        });
    });

    it('a club-wide abonement does not renew a scoped one (scopes differ)', async () => {
        const { data } = await run([
            member({
                userId: 'u',
                subscriptions: [
                    abonement({ classesRemaining: 0, directions: [BJJ] }),
                    abonement({ classesRemaining: 10 }),
                ],
            }),
        ]);
        expect(data.map((c) => c.reason)).toEqual(['out_of_classes']);
    });

    it('flags a scope that ended unrenewed while the member trains on another', async () => {
        const endedAt = new Date(Date.now() - 5 * DAY);
        const { data } = await run([
            member({
                userId: 'u',
                accessUntil: new Date(Date.now() + 60 * DAY),
                subscriptions: [
                    abonement({
                        status: 'EXPIRED',
                        endDate: endedAt,
                        planName: 'БЖЖ месяц',
                        directions: [BJJ],
                    }),
                    abonement({
                        endDate: new Date(Date.now() + 60 * DAY),
                        directions: [THAI],
                    }),
                ],
            }),
        ]);
        expect(data).toHaveLength(1);
        expect(data[0]).toMatchObject({
            reason: 'access_expiring',
            planName: 'БЖЖ месяц',
            endDate: endedAt.toISOString(),
            classesRemaining: null,
            classesTotal: null,
        });
    });

    it('does not flag an ended abonement whose scope was renewed', async () => {
        const { data } = await run([
            member({
                userId: 'u',
                accessUntil: new Date(Date.now() + 60 * DAY),
                subscriptions: [
                    abonement({
                        endDate: new Date(Date.now() + 60 * DAY),
                        directions: [BJJ],
                    }),
                    abonement({
                        status: 'EXPIRED',
                        endDate: new Date(Date.now() - 5 * DAY),
                        directions: [BJJ],
                    }),
                ],
            }),
        ]);
        expect(data).toEqual([]);
    });

    it('with no current abonement, judges the access window and points at the last ended one', async () => {
        const lapsed = new Date(Date.now() - DAY);
        const { data } = await run([
            member({
                userId: 'lapsed',
                accessUntil: lapsed,
                subscriptions: [
                    abonement({
                        status: 'EXPIRED',
                        endDate: new Date(Date.now() - 20 * DAY),
                        planName: 'Старый',
                    }),
                    abonement({
                        status: 'ACTIVE',
                        endDate: lapsed,
                        planName: 'Последний',
                        classesRemaining: 3,
                    }),
                ],
            }),
            // Access extended by hand past the abonement: not a candidate.
            member({
                userId: 'extended',
                accessUntil: new Date(Date.now() + 60 * DAY),
                subscriptions: [
                    abonement({
                        status: 'ACTIVE',
                        endDate: new Date(Date.now() - DAY),
                    }),
                ],
            }),
        ]);
        expect(data).toHaveLength(1);
        expect(data[0]).toMatchObject({
            userId: 'lapsed',
            reason: 'access_expiring',
            planName: 'Последний',
            classesRemaining: null,
            accessUntil: lapsed.toISOString(),
        });
    });

    it('picks the most urgent of several needs for one member', async () => {
        const { data } = await run([
            member({
                userId: 'u',
                subscriptions: [
                    abonement({
                        endDate: new Date(Date.now() + DAY),
                        directions: [THAI],
                    }),
                    abonement({
                        classesRemaining: 0,
                        planName: 'БЖЖ 12',
                        directions: [BJJ],
                    }),
                ],
            }),
        ]);
        expect(data).toHaveLength(1);
        expect(data[0]).toMatchObject({
            reason: 'out_of_classes',
            planName: 'БЖЖ 12',
        });
    });
});

describe('listRenewalCandidates paging and filters', () => {
    const many = ['a', 'b', 'c'].map((userId, i) =>
        member({ userId, accessUntil: new Date(Date.now() + (i + 1) * DAY) }),
    );

    it('pages the ordered list and reports the total', async () => {
        const out = await run(many, prismaFor(many), { curPage: 2, perPage: 2 });
        expect(out).toMatchObject({ total: 3, curPage: 2, perPage: 2 });
        expect(out.data.map((c) => c.userId)).toEqual(['c']);
    });

    // docs/design/2026-11-15-member-autopay.md §3.5: a row renewed by autopay
    // says so (staff don't call), and when it charges next; the agreement must
    // renew the same scope.
    it('marks a row renewed by autopay with its next charge day, for the page only', async () => {
        const end = new Date('2026-12-14T21:00:00Z'); // 15 Dec 00:00 Moscow
        (resolveAnalyticsScope as jest.Mock).mockResolvedValue({ scope: CLUB });
        const due = [
            member({
                userId: 'auto',
                accessUntil: end,
                subscriptions: [abonement({ endDate: new Date(Date.now() + 2 * DAY), directions: [BJJ] })],
            }),
            member({
                userId: 'stopped',
                accessUntil: new Date(Date.now() + 3 * DAY),
                subscriptions: [abonement({ endDate: new Date(Date.now() + 3 * DAY) })],
            }),
            member({
                userId: 'otherScope',
                accessUntil: new Date(Date.now() + 4 * DAY),
                subscriptions: [abonement({ endDate: new Date(Date.now() + 4 * DAY), directions: [THAI] })],
            }),
        ];
        const autopays = [
            {
                id: 'a1',
                userId: 'auto',
                planId: 'p1',
                status: 'ACTIVE',
                failedAttempts: 0,
                nextAttemptAt: null,
                plan: { directions: [{ directionId: BJJ.id }] },
            },
            {
                id: 'a2',
                userId: 'stopped',
                planId: 'p1',
                status: 'NEEDS_ACTION',
                failedAttempts: 4,
                nextAttemptAt: null,
                plan: { directions: [] },
            },
            {
                id: 'a3',
                userId: 'otherScope',
                planId: 'p2',
                status: 'ACTIVE',
                failedAttempts: 0,
                nextAttemptAt: null,
                plan: { directions: [{ directionId: BJJ.id }] },
            },
        ];
        // The anchor of a1: its BJJ abonement ending 15 Dec (Moscow) → S − 1.
        const anchor = {
            id: 's-auto',
            status: 'ACTIVE',
            startDate: new Date('2026-11-15T21:00:00Z'),
            endDate: end,
            classesTotal: null,
            classesRemaining: null,
            durationDays: 30,
            createdAt: new Date('2026-11-15T09:00:00Z'),
            updatedAt: new Date('2026-11-15T09:00:00Z'),
            directions: [{ directionId: BJJ.id }],
            consumedRecords: [],
            burnedBookings: [],
            workspaceMember: { userId: 'auto' },
        };
        const prisma = prismaFor(due, autopays, [anchor]);
        const out = await run(due, prisma, { perPage: 3 });
        const byId = Object.fromEntries(out.data.map((c) => [c.userId, c.autopay]));
        expect(byId).toEqual({
            auto: { status: 'ACTIVE', nextChargeOn: '2026-12-14' },
            stopped: { status: 'NEEDS_ACTION', nextChargeOn: null },
            otherScope: null,
        });
        const args = prisma.memberAutopay.findMany.mock.calls[0][0];
        expect(args.where).toEqual({
            workspaceId: 'w1',
            userId: { in: ['auto', 'stopped', 'otherScope'] },
            status: { in: ['ACTIVE', 'NEEDS_ACTION'] },
        });
    });

    it('narrows a filtered list to the students of the matching groups', async () => {
        (resolveAnalyticsScope as jest.Mock).mockResolvedValueOnce({
            scope: { groupIds: new Set(['g1']), includeGroupless: false },
        });
        const prisma = prismaFor([]);
        await run([], prisma, { groupId: 'g1' });
        expect(prisma.workspaceMember.findMany.mock.calls[0][0].where).toEqual({
            AND: [
                studentWhere('w1', 'owner'),
                { user: { groupMemberships: { some: { groupId: { in: ['g1'] } } } } },
            ],
        });
    });
});
