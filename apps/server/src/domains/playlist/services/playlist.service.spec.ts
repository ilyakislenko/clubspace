import { PlaylistService } from './playlist.service'

describe('PlaylistService.createThumbnailUpload', () => {
    const setup = (course: { id: string } | null) => {
        const prisma = {
            course: { findFirst: jest.fn().mockResolvedValue(course) },
        }
        const files = {
            getDefaultBucketName: jest.fn().mockReturnValue('clubspace'),
            getPresignedPutUrl: jest
                .fn()
                .mockResolvedValue({ url: 'https://s3/put', method: 'PUT' }),
            getPublicObjectUrl: jest.fn(
                ({ bucket, key }: { bucket: string; key: string }) =>
                    `https://s3/${bucket}/${key}`,
            ),
        }
        const service = new PlaylistService(prisma as never, files as never)
        return { service, files }
    }

    it('puts the cover under thumbnails/, the anonymously readable prefix', async () => {
        const { service, files } = setup({ id: 'c1' })
        const out = await service.createThumbnailUpload({
            workspaceId: 'w1',
            playlistId: 'c1',
            contentType: 'image/jpeg',
        })
        // Anything outside thumbnails/ (or subtitles/) is private in the
        // bucket policy, so the unsigned public URL would come back 403.
        expect(out.key).toMatch(/^thumbnails\/playlists\/c1\/[0-9a-f-]{36}$/)
        expect(files.getPresignedPutUrl).toHaveBeenCalledWith(
            expect.objectContaining({ key: out.key, contentType: 'image/jpeg' }),
        )
        expect(out.publicUrl).toBe(`https://s3/clubspace/${out.key}`)
    })

    it('refuses a course from another club', async () => {
        const { service } = setup(null)
        await expect(
            service.createThumbnailUpload({
                workspaceId: 'w1',
                playlistId: 'other',
                contentType: 'image/jpeg',
            }),
        ).rejects.toThrow('Курс не найден')
    })
})

const STAFF = {
    isStaff: true,
    groupIds: new Set<string>(),
    planIds: new Set<string>(),
    rankOrderByLadder: new Map<string, number>(),
}
const STUDENT = { ...STAFF, isStaff: false }

const COURSE_ROW = {
    id: 'c1',
    workspaceId: 'w1',
    title: 'Гард',
    slug: 'guard',
    description: null,
    thumbnailUrl: null,
    status: null,
    level: null,
    lockedProgression: false,
    isPublic: true,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    tags: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    audience: [] as unknown[],
}

const RANK_ROW = {
    kind: 'RANK',
    groupId: null,
    rankLevelId: 'lvl',
    planId: null,
    group: null,
    rankLevel: {
        name: 'Синий пояс',
        order: 2,
        ladderId: 'ladder',
        ladder: { name: 'Взрослые' },
    },
    plan: null,
}

const lesson = (videoId: string, order: number) => ({
    videoId,
    order,
    chapterId: null,
    isOptional: false,
    video: {
        id: videoId,
        title: videoId,
        description: null,
        status: 'ready',
        duration: 100,
        thumbnailUrl: null,
    },
})

describe('PlaylistService.getPlaylist', () => {
    const setup = (course: unknown, completed: string[] = []) => {
        const prisma = {
            course: { findFirst: jest.fn().mockResolvedValue(course) },
            videoWatched: {
                findMany: jest
                    .fn()
                    .mockResolvedValue(completed.map((videoId) => ({ videoId }))),
            },
        }
        return {
            service: new PlaylistService(prisma as never, {} as never),
            prisma,
        }
    }
    const get = (service: PlaylistService, viewer = STUDENT) =>
        service.getPlaylist({
            workspaceId: 'w1',
            playlistId: 'c1',
            viewer,
            userId: 'u1',
        })

    it('scopes a student to published courses not hidden by group', async () => {
        const { service, prisma } = setup({ ...COURSE_ROW, chapters: [], videos: [] })
        await get(service)
        const where = prisma.course.findFirst.mock.calls[0][0].where
        expect(where.AND).toHaveLength(2)
        expect(where.AND[0].publishedAt.lte).toBeInstanceOf(Date)
        expect(where.AND[1].OR[0]).toEqual({
            audience: { none: { kind: 'GROUP' } },
        })
    })

    it('shows staff drafts and every audience', async () => {
        const { service, prisma } = setup({ ...COURSE_ROW, chapters: [], videos: [] })
        const out = await get(service, STAFF)
        expect(prisma.course.findFirst.mock.calls[0][0].where.AND).toEqual([])
        expect(out.lock).toBeNull()
        expect(out.audienceSummary).toBeNull()
    })

    it('404s a course the student cannot see', async () => {
        const { service } = setup(null)
        await expect(get(service)).rejects.toThrow('Курс не найден')
    })

    it('locks every lesson of a rank teaser with the course reason', async () => {
        const { service } = setup({
            ...COURSE_ROW,
            audience: [RANK_ROW],
            chapters: [],
            videos: [lesson('v1', 0), lesson('v2', 1)],
        })
        const out = await get(service)
        const reason = { kind: 'RANK', reason: 'Доступно с уровня «Синий пояс»' }
        expect(out.lock).toEqual(reason)
        expect(out.videos.map((v) => v.lock)).toEqual([reason, reason])
    })

    it('opens lessons one by one under locked progression', async () => {
        const { service, prisma } = setup(
            {
                ...COURSE_ROW,
                lockedProgression: true,
                chapters: [],
                videos: [lesson('v1', 0), lesson('v2', 1), lesson('v3', 2)],
            },
            ['v1'],
        )
        const out = await get(service)
        expect(prisma.videoWatched.findMany).toHaveBeenCalledWith({
            where: { userId: 'u1', videoId: { in: ['v1', 'v2', 'v3'] }, completed: true },
            select: { videoId: true },
        })
        expect(out.lock).toBeNull()
        expect(out.videos.map((v) => v.lock?.kind ?? null)).toEqual([
            null,
            null,
            'PROGRESSION',
        ])
    })

    it('never locks progression for staff', async () => {
        const { service, prisma } = setup({
            ...COURSE_ROW,
            lockedProgression: true,
            audience: [RANK_ROW],
            chapters: [],
            videos: [lesson('v1', 0), lesson('v2', 1)],
        })
        const out = await get(service, STAFF)
        expect(out.videos.every((v) => v.lock === null)).toBe(true)
        expect(out.audienceSummary).toBe('Доступно с уровня «Синий пояс»')
        expect(prisma.videoWatched.findMany).not.toHaveBeenCalled()
    })
})

describe('PlaylistService.listPlaylists', () => {
    const setup = (rows: unknown[]) => {
        const prisma = {
            course: {
                findMany: jest.fn().mockResolvedValue(rows),
                count: jest.fn().mockResolvedValue(rows.length),
            },
            $transaction: jest.fn((ops: Array<Promise<unknown>>) => Promise.all(ops)),
        }
        return {
            service: new PlaylistService(prisma as never, {} as never),
            prisma,
        }
    }

    it('lists rank teasers with their lock and filters groups in SQL', async () => {
        const { service, prisma } = setup([
            { ...COURSE_ROW, audience: [RANK_ROW] },
            { ...COURSE_ROW, id: 'c2', audience: [] },
        ])
        const out = await service.listPlaylists({
            workspaceId: 'w1',
            q: 'гард',
            viewer: STUDENT,
        })
        const where = prisma.course.findMany.mock.calls[0][0].where
        // visibility + group filter + text search
        expect(where.AND).toHaveLength(3)
        expect(out.data.map((c) => c.lock?.kind ?? null)).toEqual(['RANK', null])
        expect(out.data.every((c) => c.audienceSummary === null)).toBe(true)
        expect(out.total).toBe(2)
    })

    it('gives staff the audience summary and no locks', async () => {
        const { service, prisma } = setup([{ ...COURSE_ROW, audience: [RANK_ROW] }])
        const out = await service.listPlaylists({ workspaceId: 'w1', viewer: STAFF })
        expect(prisma.course.findMany.mock.calls[0][0].where.AND).toEqual([])
        expect(out.data[0].lock).toBeNull()
        expect(out.data[0].audienceSummary).toBe('Доступно с уровня «Синий пояс»')
    })
})
