// Authorization is covered by the assert-admin-scope tests; stub it so these
// specs focus on the candidate selection + ordering.
jest.mock('../../shared/access/assert-admin-scope', () => ({
    assertWorkspaceAdmin: jest.fn().mockResolvedValue(undefined),
}));

import { ListRenewalCandidatesFeature } from './list-renewal-candidates.feature';
import { ListRenewalCandidatesHandler } from './list-renewal-candidates.handler';

const DAY = 24 * 60 * 60 * 1000;

const member = (o: {
    userId: string;
    classesRemaining?: number | null;
    classesTotal?: number | null;
    accessUntil?: Date | null;
}) => ({
    userId: o.userId,
    accessUntil: o.accessUntil ?? null,
    user: { firstname: 'F', lastname: 'L', email: `${o.userId}@x` },
    subscription:
        o.classesRemaining === undefined
            ? null
            : {
                  classesRemaining: o.classesRemaining,
                  classesTotal: o.classesTotal ?? 8,
                  status: 'ACTIVE',
                  endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
              },
});

const run = (members: unknown[]) => {
    const prisma = {
        workspaceMember: { findMany: jest.fn().mockResolvedValue(members) },
    };
    return new ListRenewalCandidatesHandler(
        prisma as never,
        {} as never,
    ).execute(new ListRenewalCandidatesFeature('w1', 'admin', 'admin', false));
};

describe('listRenewalCandidates', () => {
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
});
