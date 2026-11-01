// Authorization is covered by the assert-admin-scope tests; stub it so these
// specs focus on the candidate selection + ordering.
jest.mock('../../shared/access/assert-admin-scope', () => ({
    assertWorkspaceAdmin: jest.fn().mockResolvedValue(undefined),
}));

import { assertWorkspaceAdmin } from '../../shared/access/assert-admin-scope';
import { ForbiddenError } from '../../shared/errors/shared.errors';
import { ListRenewalCandidatesFeature } from './list-renewal-candidates.feature';
import { ListRenewalCandidatesHandler } from './list-renewal-candidates.handler';

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
    plan: { name: o.planName ?? 'Абонемент' },
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
    user: { firstname: 'F', lastname: 'L', email: `${o.userId}@x` },
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

const prismaFor = (members: unknown[]) => ({
    workspaceMember: { findMany: jest.fn().mockResolvedValue(members) },
});

const run = (members: unknown[], prisma = prismaFor(members)) => {
    return new ListRenewalCandidatesHandler(
        prisma as never,
        {} as never,
    ).execute(new ListRenewalCandidatesFeature('w1', 'admin', 'admin', false));
};

describe('listRenewalCandidates', () => {
    it('refuses a non-admin (coach) before touching the roster', async () => {
        (assertWorkspaceAdmin as jest.Mock).mockRejectedValueOnce(
            new ForbiddenError({ message: 'nope' }),
        );
        const findMany = jest.fn();
        const handler = new ListRenewalCandidatesHandler(
            { workspaceMember: { findMany } } as never,
            {} as never,
        );
        await expect(
            handler.execute(
                new ListRenewalCandidatesFeature('w1', 'c1', 'coach', false),
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

    it('treats an already-expired window as a candidate', async () => {
        const { data } = await run([
            member({
                userId: 'lapsed',
                accessUntil: new Date(Date.now() - DAY),
            }),
        ]);
        expect(data).toHaveLength(1);
        expect(data[0].reason).toBe('access_expiring');
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

    it('reads current plus recently ended abonements of active members', async () => {
        const prisma = prismaFor([]);
        await run([], prisma);
        const args = prisma.workspaceMember.findMany.mock.calls[0][0];
        expect(args.where).toEqual({ workspaceId: 'w1', status: 'ACTIVE' });
        const or = args.select.subscriptions.where.OR;
        expect(or[0]).toEqual({
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
                reason: 'low_classes',
                classesRemaining: 1,
                classesTotal: 12,
                accessUntil: end.toISOString(),
                planName: 'БЖЖ 12',
                endDate: end.toISOString(),
                directions: [BJJ],
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
