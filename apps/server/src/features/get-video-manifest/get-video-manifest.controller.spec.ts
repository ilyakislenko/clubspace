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
    workspace?: unknown
    member?: unknown
    manifest?: string
}

const build = (o: Overrides = {}) => {
    const prisma = {
        video: {
            findUnique: jest
                .fn()
                .mockResolvedValue('video' in o ? o.video : VIDEO),
        },
        workspace: {
            findUnique: jest
                .fn()
                .mockResolvedValue(
                    'workspace' in o ? o.workspace : { ownerId: 'owner-1' },
                ),
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
            .mockResolvedValue(o.manifest ?? '#EXTM3U\nseg_00000.ts'),
        getPresignedGetUrl: jest
            .fn()
            .mockResolvedValue('https://signed.example/seg'),
    }
    const controller = new GetVideoManifestController(
        prisma as never,
        files as never,
    )
    return { controller, prisma, files }
}

// Returns the HttpException status a rejected call produced (0 = resolved).
const statusOf = async (p: Promise<unknown>): Promise<number> => {
    try {
        await p
        return 0
    } catch (e) {
        return e instanceof HttpException ? e.getStatus() : -1
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

    it('forbids a non-member with 403', async () => {
        const { controller } = build({ member: null })
        const token = tokenFor('vid-1', 'stranger')
        expect(
            await statusOf(controller.getManifest('vid-1', token, undefined)),
        ).toBe(403)
    })

    it('serves the owner even with no membership row', async () => {
        // Owner has no member row in the normal creation flow; the owner
        // bypass must still let their player fetch the manifest.
        const { controller } = build({ member: null })
        const token = tokenFor('vid-1', 'owner-1')
        expect(
            await statusOf(controller.getManifest('vid-1', token, undefined)),
        ).toBe(0)
    })

    it('forbids a member whose access window has expired with 403', async () => {
        const { controller } = build({
            member: {
                id: 'm1',
                status: 'ACTIVE',
                accessUntil: new Date(Date.now() - 1000),
            },
        })
        const token = tokenFor('vid-1', 'member-1')
        expect(
            await statusOf(controller.getManifest('vid-1', token, undefined)),
        ).toBe(403)
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
