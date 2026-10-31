import { HttpException } from '@nestjs/common'

// Deterministic playback secret so issue/verify agree, and so we don't pull in
// the real environment.ts (which .required()s DATABASE_URL etc. at import).
jest.mock('../../environments/environment', () => ({
    environment: {
        playbackTokenSecret: 'manifest-spec-playback-secret-long-enough',
    },
}))

// The controller only uses these as injected constructor deps (we pass our own
// stubs below); mock the modules so importing the controller doesn't pull in
// the ESM-only generated prisma client / AWS SDK, which jest can't parse.
jest.mock('../../infrastructure/prisma', () => ({ PrismaService: class {} }))
jest.mock('../../infrastructure/files/services/files.service', () => ({
    FilesService: class {},
}))
jest.mock('../../domains/playlist/services/course-access.service', () => ({
    CourseAccessService: class {},
}))

import { ForbiddenError, NotFoundError } from '../../shared/errors/shared.errors'
import { issuePlaybackToken } from '../../shared/utils/playback-token.util'
import { GetVideoManifestController } from './get-video-manifest.controller'

const VIDEO = {
    id: 'vid-1',
    workspaceId: 'ws-1',
    hlsBucket: 'hls',
    hlsMasterKey: 'hls/vid-1/master.m3u8',
    status: 'ready',
}

type Overrides = {
    video?: unknown
    // What CourseAccessService.assertCanWatchVideo throws (membership,
    // audience, progression — covered in course-access.service.spec.ts).
    refuse?: Error
    manifest?: string
}

const build = (o: Overrides = {}) => {
    const prisma = {
        video: {
            findUnique: jest
                .fn()
                .mockResolvedValue('video' in o ? o.video : VIDEO),
        },
    }
    const files = {
        getDefaultBucketName: jest.fn().mockReturnValue('hls'),
        getObjectText: jest
            .fn()
            .mockResolvedValue(o.manifest ?? '#EXTM3U\nseg_00000.ts'),
        getPresignedGetUrl: jest
            .fn()
            .mockResolvedValue('https://signed.example/seg'),
    }
    const courseAccess = {
        assertCanWatchVideo: o.refuse
            ? jest.fn().mockRejectedValue(o.refuse)
            : jest.fn().mockResolvedValue({ isStaff: false }),
    }
    const controller = new GetVideoManifestController(
        prisma as never,
        files as never,
        courseAccess as never,
    )
    return { controller, prisma, files, courseAccess }
}

// The HTTP status a rejected call produced (0 = resolved): HttpException from
// the controller itself, DefaultError.statusCode from the access gate.
const statusOf = async (p: Promise<unknown>): Promise<number> => {
    try {
        await p
        return 0
    } catch (e) {
        if (e instanceof HttpException) return e.getStatus()
        if (e instanceof ForbiddenError || e instanceof NotFoundError) {
            return e.statusCode
        }
        return -1
    }
}

const tokenFor = (videoId: string, userId: string) =>
    issuePlaybackToken({ videoId, userId })

describe('GetVideoManifestController', () => {
    it('rejects a missing token with 401', async () => {
        const { controller } = build()
        expect(
            await statusOf(controller.getManifest('vid-1', undefined, undefined)),
        ).toBe(401)
    })

    it('rejects a malformed token with 401', async () => {
        const { controller } = build()
        expect(
            await statusOf(controller.getManifest('vid-1', 'garbage', undefined)),
        ).toBe(401)
    })

    it('rejects a token minted for a different video with 401', async () => {
        const { controller } = build()
        const token = tokenFor('some-other-video', 'owner-1')
        expect(
            await statusOf(controller.getManifest('vid-1', token, undefined)),
        ).toBe(401)
    })

    it('rejects a path-traversal subPath with 400', async () => {
        const { controller } = build()
        const token = tokenFor('vid-1', 'owner-1')
        expect(
            await statusOf(
                controller.getManifest('vid-1', token, 'hls/vid-1/../secrets'),
            ),
        ).toBe(400)
    })

    it('rejects a subPath outside the video prefix with 400', async () => {
        const { controller } = build()
        const token = tokenFor('vid-1', 'owner-1')
        expect(
            await statusOf(
                controller.getManifest('vid-1', token, 'hls/other-video/seg.ts'),
            ),
        ).toBe(400)
    })

    it('refuses with the gate status when the viewer may not watch (403)', async () => {
        const { controller, files } = build({
            refuse: new ForbiddenError({ message: 'Сначала посмотрите предыдущий урок' }),
        })
        const token = tokenFor('vid-1', 'member-1')
        expect(
            await statusOf(controller.getManifest('vid-1', token, undefined)),
        ).toBe(403)
        expect(files.getObjectText).not.toHaveBeenCalled()
    })

    it('hides a video outside every visible course (404)', async () => {
        const { controller } = build({
            refuse: new NotFoundError({ message: 'Видео не найдено' }),
        })
        const token = tokenFor('vid-1', 'member-1')
        expect(
            await statusOf(controller.getManifest('vid-1', token, undefined)),
        ).toBe(404)
    })

    it('checks access for the user the token was minted for', async () => {
        const { controller, courseAccess } = build()
        const token = tokenFor('vid-1', 'member-1')
        await controller.getManifest('vid-1', token, undefined)
        expect(courseAccess.assertCanWatchVideo).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'vid-1', workspaceId: 'ws-1' }),
            'member-1',
        )
    })

    it('serves the manifest with segments rewritten to signed URLs', async () => {
        const { controller, files } = build()
        const token = tokenFor('vid-1', 'owner-1')
        const out = await controller.getManifest('vid-1', token, undefined)
        expect(files.getObjectText).toHaveBeenCalledWith({
            bucket: 'hls',
            key: 'hls/vid-1/master.m3u8',
        })
        expect(files.getPresignedGetUrl).toHaveBeenCalledWith({
            bucket: 'hls',
            key: 'hls/vid-1/seg_00000.ts',
        })
        expect(out).toContain('https://signed.example/seg')
    })

    it('rewrites variant playlist lines back through the proxy, not signed', async () => {
        const { controller, files } = build({
            manifest: '#EXTM3U\nv0/playlist.m3u8',
        })
        const token = tokenFor('vid-1', 'owner-1')
        const out = await controller.getManifest('vid-1', token, undefined)
        expect(out).toContain('manifest.m3u8?token=')
        expect(out).toContain('path=')
        expect(files.getPresignedGetUrl).not.toHaveBeenCalled()
    })
})
