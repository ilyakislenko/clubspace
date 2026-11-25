jest.mock('../../../environments/environment', () => ({
    environment: { organizations: { enabled: true } },
}))

import {
    ForbiddenError,
    NotFoundError,
    StaleUpdateError,
} from '../../../shared/errors/shared.errors'
import { CreateOrgAnnouncementFeature } from './create-org-announcement.feature'
import { CreateOrgAnnouncementHandler } from './create-org-announcement.handler'
import { DeleteOrgAnnouncementFeature } from './delete-org-announcement.feature'
import { DeleteOrgAnnouncementHandler } from './delete-org-announcement.handler'
import { ListOrgAnnouncementsFeature } from './list-org-announcements.feature'
import { ListOrgAnnouncementsHandler } from './list-org-announcements.handler'
import { resolvePublishedAt } from './schemas'
import { UpdateOrgAnnouncementFeature } from './update-org-announcement.feature'
import { UpdateOrgAnnouncementHandler } from './update-org-announcement.handler'

const ORG = '11111111-1111-4111-8111-111111111111'
const orgRbac = (role: 'ORG_ADMIN' | 'ORG_COACH' = 'ORG_ADMIN') => ({
    resolveOrgScope: jest.fn(async (c: object) => ({ ...c, role })),
})
const row = (o: Record<string, unknown> = {}) => ({
    id: 'oa1',
    organizationId: ORG,
    title: 'Положение о турнире',
    body: 'Опубликовано',
    audience: 'STAFF_AND_MEMBERS',
    publishedAt: new Date('2026-11-26T09:00:00Z'),
    staffNotifiedAt: null,
    authorName: 'Николай Белов',
    createdAt: new Date('2026-11-26T09:00:00Z'),
    updatedAt: new Date('2026-11-26T09:00:00Z'),
    ...o,
})

describe('resolvePublishedAt', () => {
    const now = new Date('2026-11-26T12:00:00Z')
    it('schedules, publishes now, keeps a live time, drafts or leaves alone', () => {
        expect(resolvePublishedAt({ publishAt: '2026-12-01T09:00:00Z' }, null, now)).toEqual(
            new Date('2026-12-01T09:00:00Z'),
        )
        expect(resolvePublishedAt({ publish: true }, null, now)).toBe(now)
        const live = new Date('2026-11-20T00:00:00Z')
        expect(resolvePublishedAt({ publish: true }, live, now)).toBe(live)
        expect(resolvePublishedAt({ publish: true }, new Date('2026-12-30Z'), now)).toBe(now)
        expect(resolvePublishedAt({ publish: false }, live, now)).toBeNull()
        expect(resolvePublishedAt({}, live, now)).toBeUndefined()
    })
})

describe('createOrgAnnouncement', () => {
    it('lets an org admin publish, signed with their name, audited with the org', async () => {
        const prisma = {
            user: {
                findUnique: jest.fn().mockResolvedValue({
                    firstname: 'Николай',
                    lastname: 'Белов',
                    email: 'federation@academy.demo',
                }),
            },
            organizationAnnouncement: { create: jest.fn(async ({ data }) => row(data)) },
        }
        const audit = { record: jest.fn() }
        const out = await new CreateOrgAnnouncementHandler(
            prisma as never,
            orgRbac() as never,
            audit as never,
        ).execute(
            new CreateOrgAnnouncementFeature(
                { title: 'Собрание', body: '5 декабря', publish: true },
                ORG,
                'u1',
                false,
            ),
        )
        const data = prisma.organizationAnnouncement.create.mock.calls[0][0].data
        expect(data).toMatchObject({
            organizationId: ORG,
            authorId: 'u1',
            authorName: 'Николай Белов',
            audience: 'STAFF',
        })
        expect(data.publishedAt).toBeInstanceOf(Date)
        expect(out.title).toBe('Собрание')
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'org.announcementCreate',
                organizationId: ORG,
                targetType: 'organizationAnnouncement',
            }),
        )
    })

    it('keeps a draft without publish', async () => {
        const prisma = {
            user: { findUnique: jest.fn().mockResolvedValue(null) },
            organizationAnnouncement: { create: jest.fn(async ({ data }) => row(data)) },
        }
        await new CreateOrgAnnouncementHandler(
            prisma as never,
            orgRbac() as never,
            { record: jest.fn() } as never,
        ).execute(new CreateOrgAnnouncementFeature({ title: 't', body: 'b' }, ORG, 'u1', false))
        expect(prisma.organizationAnnouncement.create.mock.calls[0][0].data).toMatchObject({
            publishedAt: null,
            authorName: 'Федерация',
        })
    })

    it('refuses an org coach (announcements are read-only for them)', async () => {
        await expect(
            new CreateOrgAnnouncementHandler(
                {} as never,
                orgRbac('ORG_COACH') as never,
                { record: jest.fn() } as never,
            ).execute(new CreateOrgAnnouncementFeature({ title: 't', body: 'b' }, ORG, 'u1', false)),
        ).rejects.toBeInstanceOf(ForbiddenError)
    })
})

describe('updateOrgAnnouncement', () => {
    const prismaFor = (current: unknown, claimed = 1) => {
        const prisma = {
            organizationAnnouncement: {
                findFirst: jest.fn().mockResolvedValue(current),
                updateMany: jest.fn().mockResolvedValue({ count: claimed }),
                update: jest.fn(async ({ data }) => row(data)),
            },
            $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
        }
        return prisma
    }

    it('edits fields and keeps the live publish time', async () => {
        const live = new Date('2026-11-20T00:00:00Z')
        const prisma = prismaFor({ id: 'oa1', publishedAt: live })
        await new UpdateOrgAnnouncementHandler(
            prisma as never,
            orgRbac() as never,
            { record: jest.fn() } as never,
        ).execute(
            new UpdateOrgAnnouncementFeature(
                { title: 'Новое', publish: true, expectedUpdatedAt: '2026-11-26T09:00:00.000Z' },
                ORG,
                'oa1',
                'u1',
                false,
            ),
        )
        expect(prisma.organizationAnnouncement.findFirst.mock.calls[0][0].where).toEqual({
            id: 'oa1',
            organizationId: ORG,
        })
        expect(prisma.organizationAnnouncement.update.mock.calls[0][0].data).toEqual({
            title: 'Новое',
            publishedAt: live,
        })
    })

    it('refuses a stale save, a foreign announcement and an org coach', async () => {
        const run = (prisma: unknown, rbac = orgRbac()) =>
            new UpdateOrgAnnouncementHandler(
                prisma as never,
                rbac as never,
                { record: jest.fn() } as never,
            ).execute(
                new UpdateOrgAnnouncementFeature(
                    { body: 'x', expectedUpdatedAt: '2026-11-26T09:00:00.000Z' },
                    ORG,
                    'oa1',
                    'u1',
                    false,
                ),
            )
        await expect(run(prismaFor({ id: 'oa1', publishedAt: null }, 0))).rejects.toBeInstanceOf(
            StaleUpdateError,
        )
        await expect(run(prismaFor(null))).rejects.toBeInstanceOf(NotFoundError)
        await expect(run(prismaFor(null), orgRbac('ORG_COACH'))).rejects.toBeInstanceOf(
            ForbiddenError,
        )
    })
})

describe('deleteOrgAnnouncement / listOrgAnnouncements', () => {
    it('deletes only within the org and audits it', async () => {
        const prisma = {
            organizationAnnouncement: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
        }
        const audit = { record: jest.fn() }
        await expect(
            new DeleteOrgAnnouncementHandler(prisma as never, orgRbac() as never, audit as never).execute(
                new DeleteOrgAnnouncementFeature(ORG, 'oa1', 'u1', false),
            ),
        ).resolves.toEqual({ status: 'deleted' })
        expect(prisma.organizationAnnouncement.deleteMany.mock.calls[0][0].where).toEqual({
            id: 'oa1',
            organizationId: ORG,
        })
        expect(audit.record).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'org.announcementDelete' }),
        )
        prisma.organizationAnnouncement.deleteMany.mockResolvedValue({ count: 0 })
        await expect(
            new DeleteOrgAnnouncementHandler(prisma as never, orgRbac() as never, audit as never).execute(
                new DeleteOrgAnnouncementFeature(ORG, 'oa1', 'u1', false),
            ),
        ).rejects.toBeInstanceOf(NotFoundError)
    })

    it('lets the whole team read, drafts first', async () => {
        const prisma = {
            organizationAnnouncement: {
                findMany: jest.fn().mockResolvedValue([row()]),
                count: jest.fn().mockResolvedValue(1),
            },
        }
        const out = await new ListOrgAnnouncementsHandler(
            prisma as never,
            orgRbac('ORG_COACH') as never,
        ).execute(new ListOrgAnnouncementsFeature({}, ORG, 'u1', false))
        expect(out).toMatchObject({ total: 1, curPage: 1, perPage: 20 })
        expect(out.data[0]).toMatchObject({
            id: 'oa1',
            audience: 'STAFF_AND_MEMBERS',
            publishedAt: '2026-11-26T09:00:00.000Z',
            staffNotifiedAt: null,
        })
        expect(prisma.organizationAnnouncement.findMany.mock.calls[0][0].orderBy[0]).toEqual({
            publishedAt: { sort: 'desc', nulls: 'first' },
        })
    })
})
