jest.mock('../../../infrastructure/prisma', () => ({
    PrismaService: class {},
    Prisma: {},
    NotificationTypeEnum: { EMAIL: 'EMAIL', PUSH: 'PUSH', TELEGRAM: 'TELEGRAM' },
}))
jest.mock('../../../infrastructure/files/services/files.service', () => ({
    FilesService: class {},
}))
jest.mock('../../../environments/environment', () => ({
    environment: { s3Storage: {} },
}))

import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../../shared/errors/shared.errors'
import { VideoService } from './video.service'

type PrismaOverrides = {
    video?: unknown
    tags?: Array<{ id: string }>
    categories?: Array<{ id: string }>
    course?: unknown
    courses?: Array<{ id: string }>
}

const build = (o: PrismaOverrides = {}) => {
    const prisma = {
        video: {
            findFirst: jest
                .fn()
                .mockResolvedValue('video' in o ? o.video : { id: 'vid-1' }),
        },
        tagEntity: { findMany: jest.fn().mockResolvedValue(o.tags ?? []) },
        category: { findMany: jest.fn().mockResolvedValue(o.categories ?? []) },
        course: {
            findFirst: jest
                .fn()
                .mockResolvedValue('course' in o ? o.course : { id: 'c1' }),
            findMany: jest.fn().mockResolvedValue(o.courses ?? []),
        },
        // Validation throws before the transaction; for the happy path just
        // resolve so updateVideo returns without executing the real callback.
        $transaction: jest.fn().mockResolvedValue({ id: 'vid-1' }),
    }
    const service = new VideoService(prisma as never, {} as never)
    return { service, prisma }
}

const update = (service: VideoService, data: Record<string, unknown>) =>
    service.updateVideo({ workspaceId: 'ws-1', videoId: 'vid-1', data })

describe('VideoService.updateVideo cross-tenant validation', () => {
    it('throws when the video is not in this workspace', async () => {
        const { service } = build({ video: null })
        await expect(update(service, { title: 'x' })).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })

    it('rejects tags that do not all belong to the workspace', async () => {
        // Asked to attach two tags, but only one exists in this workspace.
        const { service } = build({ tags: [{ id: 't1' }] })
        await expect(
            update(service, { tagIds: ['t1', 't2'] }),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('rejects categories that do not all belong to the workspace', async () => {
        const { service } = build({ categories: [{ id: 'cat1' }] })
        await expect(
            update(service, { categoryIds: ['cat1', 'cat2'] }),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('rejects a playlistId from another workspace', async () => {
        const { service } = build({ course: null })
        await expect(
            update(service, { playlistId: 'foreign-course' }),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('rejects playlistIds that do not all belong to the workspace', async () => {
        const { service } = build({ courses: [{ id: 'c1' }] })
        await expect(
            update(service, { playlistIds: ['c1', 'c2'] }),
        ).rejects.toBeInstanceOf(BadRequestError)
    })

    it('passes validation when every reference belongs to the workspace', async () => {
        const { service, prisma } = build({
            tags: [{ id: 't1' }, { id: 't2' }],
            categories: [{ id: 'cat1' }],
            courses: [{ id: 'c1' }],
        })
        // Reaching the write transaction proves validation accepted every
        // reference. (The post-write response mapping isn't stubbed here, so
        // we don't assert on the return value — only that we got past the
        // cross-tenant checks.)
        await update(service, {
            tagIds: ['t1', 't2'],
            categoryIds: ['cat1'],
            playlistIds: ['c1'],
        }).catch(() => undefined)
        expect(prisma.$transaction).toHaveBeenCalled()
    })
})

const buildPublish = (o: {
    members: Array<{ userId: string }>
    optedOut?: Array<{ userId: string }>
    ledgerConflict?: boolean
    initialVideo?: unknown
}) => {
    const created: any[] = []
    const prisma = {
        video: {
            findFirst: jest
                .fn()
                .mockResolvedValue(
                    o.initialVideo ?? {
                        id: 'vid-1',
                        isPublic: false,
                        title: 'My Video',
                    },
                ),
        },
        tagEntity: { findMany: jest.fn().mockResolvedValue([]) },
        category: { findMany: jest.fn().mockResolvedValue([]) },
        course: {
            findFirst: jest.fn().mockResolvedValue({ id: 'c1' }),
            findMany: jest.fn().mockResolvedValue([]),
        },
        $transaction: jest.fn().mockResolvedValue(undefined),
        notificationDispatchLog: {
            create: jest.fn(async () => {
                if (o.ledgerConflict) {
                    const e = new Error('uniq') as Error & { code: string }
                    e.code = 'P2002'
                    throw e
                }
                return {}
            }),
        },
        workspaceMember: {
            findMany: jest.fn().mockResolvedValue(o.members),
        },
        notificationPreferences: {
            findMany: jest.fn().mockResolvedValue(o.optedOut ?? []),
        },
        notification: {
            createMany: jest.fn(async ({ data }: any) => {
                created.push(...data)
                return { count: data.length }
            }),
        },
    }
    const service = new VideoService(prisma as never, {} as never)
    return { service, prisma, created }
}

describe('VideoService.updateVideo — new-video announcement', () => {
    it('announces a newly published video to members who did not opt out', async () => {
        const { service, prisma, created } = buildPublish({
            members: [{ userId: 'u-1' }, { userId: 'u-2' }, { userId: 'u-3' }],
            optedOut: [{ userId: 'u-2' }],
        })
        await service
            .updateVideo({
                workspaceId: 'ws-1',
                videoId: 'vid-1',
                actorId: 'coach-1',
                data: { isPublic: true },
            })
            .catch(() => undefined)

        expect(prisma.notificationDispatchLog.create).toHaveBeenCalledWith({
            data: { kind: 'video.published', refId: 'vid-1' },
        })
        expect(created).toHaveLength(2) // u-1 + u-3; u-2 opted out
        expect(created[0]).toMatchObject({
            type: 'PUSH',
            topic: 'Новое видео',
            message: 'My Video',
            metadata: { videoId: 'vid-1' },
        })
    })

    it('does not announce again once the video is in the ledger', async () => {
        const { service, prisma, created } = buildPublish({
            members: [{ userId: 'u-1' }],
            ledgerConflict: true,
        })
        await service
            .updateVideo({
                workspaceId: 'ws-1',
                videoId: 'vid-1',
                data: { isPublic: true },
            })
            .catch(() => undefined)

        expect(created).toHaveLength(0)
        expect(prisma.notification.createMany).not.toHaveBeenCalled()
    })

    it('does not announce when isPublic is not being turned on', async () => {
        const { service, prisma } = buildPublish({ members: [{ userId: 'u-1' }] })
        await service
            .updateVideo({
                workspaceId: 'ws-1',
                videoId: 'vid-1',
                data: { title: 'renamed' },
            })
            .catch(() => undefined)

        expect(prisma.notificationDispatchLog.create).not.toHaveBeenCalled()
    })

    it('does not re-announce a video that was already public', async () => {
        const { service, prisma } = buildPublish({
            members: [{ userId: 'u-1' }],
            initialVideo: { id: 'vid-1', isPublic: true, title: 'x' },
        })
        await service
            .updateVideo({
                workspaceId: 'ws-1',
                videoId: 'vid-1',
                data: { isPublic: true },
            })
            .catch(() => undefined)

        expect(prisma.notificationDispatchLog.create).not.toHaveBeenCalled()
    })
})

const buildComplete = (o: {
    video?: unknown
    objectExists?: boolean
}) => {
    const prisma = {
        video: {
            findFirst: jest
                .fn()
                .mockResolvedValue(
                    'video' in o
                        ? o.video
                        : { id: 'vid-1', rawBucket: 'raw', rawKey: 'raw/vid-1.mp4' },
                ),
            update: jest.fn().mockResolvedValue({}),
        },
    }
    const files = {
        objectExists: jest.fn().mockResolvedValue(o.objectExists ?? true),
        getDefaultBucketName: jest.fn().mockReturnValue('raw'),
    }
    const service = new VideoService(prisma as never, files as never)
    return { service, prisma, files }
}

describe('VideoService.completeUpload', () => {
    const call = (service: VideoService) =>
        service.completeUpload({ videoId: 'vid-1', workspaceId: 'ws-1' })

    it('throws when the video is not in this workspace', async () => {
        const { service } = buildComplete({ video: null })
        await expect(call(service)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('throws when the video has no rawKey', async () => {
        const { service } = buildComplete({
            video: { id: 'vid-1', rawBucket: 'raw', rawKey: null },
        })
        await expect(call(service)).rejects.toBeInstanceOf(BadRequestError)
    })

    it('refuses to complete when the uploaded object is missing', async () => {
        const { service, prisma } = buildComplete({ objectExists: false })
        await expect(call(service)).rejects.toBeInstanceOf(BadRequestError)
        // Must not flip the video to "uploaded" (which would enqueue transcoding
        // of a non-existent object).
        expect(prisma.video.update).not.toHaveBeenCalled()
    })

    it('marks the video uploaded once the object is confirmed present', async () => {
        const { service, prisma } = buildComplete({ objectExists: true })
        await call(service)
        expect(prisma.video.update).toHaveBeenCalledWith({
            where: { id: 'vid-1' },
            data: { status: 'uploaded' },
        })
    })
})

const buildOffline = (o: {
    video?: unknown
    member?: unknown
    ownerId?: string
    mediaPlaylist?: string
}) => {
    const prisma = {
        video: {
            findUnique: jest.fn().mockResolvedValue(
                'video' in o
                    ? o.video
                    : {
                          id: 'vid-1',
                          workspaceId: 'ws-1',
                          status: 'ready',
                          hlsBucket: 'hls',
                          hlsMasterKey: 'hls/vid-1/master.m3u8',
                      },
            ),
        },
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ ownerId: o.ownerId ?? 'owner-1' }),
        },
        workspaceMember: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    'member' in o
                        ? o.member
                        : { id: 'm1', status: 'ACTIVE', accessUntil: null },
                ),
        },
    }
    const files = {
        getDefaultBucketName: jest.fn().mockReturnValue('hls'),
        getObjectText: jest
            .fn()
            .mockResolvedValue(
                o.mediaPlaylist ??
                    '#EXTM3U\n#EXTINF:4,\nseg_00000.ts\n#EXTINF:4,\nseg_00001.ts\n#EXT-X-ENDLIST',
            ),
        getPresignedGetUrl: jest
            .fn()
            .mockImplementation(({ key }: { key: string }) =>
                Promise.resolve(`https://signed.example/${key}?sig=x`),
            ),
    }
    const service = new VideoService(prisma as never, files as never)
    return { service, prisma, files }
}

describe('VideoService.getOfflineManifest', () => {
    const call = (service: VideoService) =>
        service.getOfflineManifest({ videoId: 'vid-1', userId: 'owner-1' })

    it('returns a flat playlist with segments rewritten to presigned URLs', async () => {
        const { service, files } = buildOffline({})
        const { manifest } = await call(service)
        // Pulls the 720p rung (v1) and signs each segment under its dir.
        expect(files.getObjectText).toHaveBeenCalledWith({
            bucket: 'hls',
            key: 'hls/vid-1/v1/playlist.m3u8',
        })
        expect(manifest).toContain(
            'https://signed.example/hls/vid-1/v1/seg_00000.ts',
        )
        expect(manifest).not.toMatch(/^seg_00000\.ts$/m)
        // Tag lines are preserved.
        expect(manifest).toContain('#EXTINF:4,')
    })

    it('falls back to v0 when the 720p rung is missing', async () => {
        const { service, files } = buildOffline({})
        files.getObjectText
            .mockRejectedValueOnce(new Error('no v1'))
            .mockResolvedValueOnce('#EXTM3U\nseg_00000.ts\n#EXT-X-ENDLIST')
        const { manifest } = await call(service)
        expect(manifest).toContain(
            'https://signed.example/hls/vid-1/v0/seg_00000.ts',
        )
    })

    it('forbids a non-member who is not the owner', async () => {
        // The caller (userId 'owner-1') must not be the workspace owner here,
        // otherwise the owner bypass would (correctly) let them through.
        const { service } = buildOffline({ member: null, ownerId: 'someone-else' })
        await expect(call(service)).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('allows the owner even with no membership row', async () => {
        // Default ownerId equals the calling user; the normal workspace
        // creation flow leaves the owner without a WorkspaceMember row, so the
        // owner bypass must let them through.
        const { service } = buildOffline({ member: null })
        await expect(call(service)).resolves.toBeDefined()
    })

    it('forbids a non-owner whose access window has expired', async () => {
        const { service } = buildOffline({
            ownerId: 'someone-else',
            member: { id: 'm1', status: 'ACTIVE', accessUntil: new Date('2000-01-01') },
        })
        await expect(call(service)).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('rejects a video that is not ready', async () => {
        const { service } = buildOffline({
            video: {
                id: 'vid-1',
                workspaceId: 'ws-1',
                status: 'processing',
                hlsBucket: 'hls',
                hlsMasterKey: null,
            },
        })
        await expect(call(service)).rejects.toBeInstanceOf(BadRequestError)
    })
})
