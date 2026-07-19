import { CreateAnnouncementFeature } from './create-announcement.feature';
import { CreateAnnouncementHandler } from './create-announcement.handler';
import { GetAnnouncementFeedFeature } from './get-feed.feature';
import { GetAnnouncementFeedHandler } from './get-feed.handler';

const rbac = (admin = true) => ({
  resolveCoachScope: jest
    .fn()
    .mockResolvedValue({ scope: admin ? 'admin' : 'coach_own_only' }),
  canWriteAllGroups: jest.fn().mockReturnValue(admin),
});

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  title: 'Closed Friday',
  body: 'Gym closed',
  pinned: false,
  publishedAt: null,
  author: { firstname: 'Coach', lastname: null, email: 'c@x' },
  createdAt: new Date('2026-07-04T00:00:00Z'),
  updatedAt: new Date('2026-07-04T00:00:00Z'),
  ...over,
});

describe('createAnnouncement', () => {
  it('publishes immediately when publish=true', async () => {
    const prisma = {
      announcement: {
        create: jest
          .fn()
          .mockResolvedValue(row({ publishedAt: new Date('2026-07-04Z') })),
      },
    };
    await new CreateAnnouncementHandler(
      prisma as never,
      rbac() as never,
      { notifyWorkspace: jest.fn() } as never,
      { invalidate: jest.fn(), emitListDelta: jest.fn() } as never,
    ).execute(
      new CreateAnnouncementFeature(
        { title: 'T', body: 'B', publish: true },
        'w1',
        'u1',
        'admin',
        false,
      ),
    );
    expect(
      prisma.announcement.create.mock.calls[0][0].data.publishedAt,
    ).toBeInstanceOf(Date);
  });

  it('leaves a draft (publishedAt null) when publish is absent', async () => {
    const prisma = {
      announcement: { create: jest.fn().mockResolvedValue(row()) },
    };
    const out = await new CreateAnnouncementHandler(
      prisma as never,
      rbac() as never,
      { notifyWorkspace: jest.fn() } as never,
      { invalidate: jest.fn(), emitListDelta: jest.fn() } as never,
    ).execute(
      new CreateAnnouncementFeature(
        { title: 'T', body: 'B' },
        'w1',
        'u1',
        'admin',
        false,
      ),
    );
    expect(
      prisma.announcement.create.mock.calls[0][0].data.publishedAt,
    ).toBeNull();
    expect(out.publishedAt).toBeNull();
    expect(out.authorName).toBe('Coach');
  });

  it('forbids a non-admin', async () => {
    const prisma = { announcement: { create: jest.fn() } };
    await expect(
      new CreateAnnouncementHandler(
        prisma as never,
        rbac(false) as never,
        { notifyWorkspace: jest.fn() } as never,
        { invalidate: jest.fn(), emitListDelta: jest.fn() } as never,
      ).execute(
        new CreateAnnouncementFeature(
          { title: 'T', body: 'B' },
          'w1',
          'u1',
          'coach',
          false,
        ),
      ),
    ).rejects.toThrow(/admin/i);
    expect(prisma.announcement.create).not.toHaveBeenCalled();
  });
});

describe('getAnnouncementFeed', () => {
  it('returns only live announcements (publishedAt <= now), pinned-first', async () => {
    const prisma = {
      announcement: {
        findMany: jest
          .fn()
          .mockResolvedValue([row({ publishedAt: new Date('2026-07-04Z') })]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const out = await new GetAnnouncementFeedHandler(prisma as never).execute(
      new GetAnnouncementFeedFeature({}, 'w1'),
    );
    const call = prisma.announcement.findMany.mock.calls[0][0];
    // Scheduled-for-later (future publishedAt) and drafts (null) stay hidden.
    expect(call.where.workspaceId).toBe('w1');
    expect(call.where.publishedAt.lte).toBeInstanceOf(Date);
    expect(call.orderBy).toEqual([{ pinned: 'desc' }, { publishedAt: 'desc' }]);
    expect(out.total).toBe(1);
    expect(out.data[0]).toMatchObject({ id: 'a1', authorName: 'Coach' });
  });

  it('does not notify or feed-delta a scheduled (future) announcement', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const notifyWorkspace = jest.fn();
    const emitListDelta = jest.fn();
    const prisma = {
      announcement: {
        create: jest.fn().mockResolvedValue(
          row({ publishedAt: new Date(future) }),
        ),
      },
    };
    await new CreateAnnouncementHandler(
      prisma as never,
      rbac() as never,
      { notifyWorkspace } as never,
      { invalidate: jest.fn(), emitListDelta } as never,
    ).execute(
      new CreateAnnouncementFeature(
        { title: 'T', body: 'B', publishAt: future },
        'w1',
        'u1',
        'admin',
        false,
      ),
    );
    expect(notifyWorkspace).not.toHaveBeenCalled();
    expect(emitListDelta).not.toHaveBeenCalled();
  });
});
