jest.mock('../../domains/video/services/video.service', () => ({
    tooLargeMessage: (max: number) => `too large ${max}`,
}))

import { HttpException } from '@nestjs/common'

import { Prisma } from '../../infrastructure/prisma'

import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { verifyPlaybackToken, issuePlaybackToken } from '../../shared/utils/playback-token.util'
import { CompleteMyVideoReviewUploadFeature } from './complete-my-video-review-upload.feature'
import { CompleteMyVideoReviewUploadHandler } from './complete-my-video-review-upload.handler'
import { CreateMyVideoReviewFeature } from './create-my-video-review.feature'
import {
    CreateMyVideoReviewHandler,
    MAX_ACTIVE_REVIEWS,
} from './create-my-video-review.handler'
import { DeleteMyVideoReviewFeature } from './delete-my-video-review.feature'
import { DeleteMyVideoReviewHandler } from './delete-my-video-review.handler'
import { GetVideoReviewPlaybackFeature } from './get-video-review-playback.feature'
import { GetVideoReviewPlaybackHandler } from './get-video-review-playback.handler'
import { GetVideoReviewFeature } from './get-video-review.feature'
import { GetVideoReviewHandler } from './get-video-review.handler'
import { ListClubVideoReviewsFeature } from './list-club-video-reviews.feature'
import { ListClubVideoReviewsHandler } from './list-club-video-reviews.handler'
import { ListMyVideoReviewsFeature } from './list-my-video-reviews.feature'
import { ListMyVideoReviewsHandler } from './list-my-video-reviews.handler'
import { ReviewClipManifestController } from './review-clip-manifest.controller'
import { SetVideoReviewStatusFeature } from './set-video-review-status.feature'
import { SetVideoReviewStatusHandler } from './set-video-review-status.handler'
import {
    AddVideoReviewCommentFeature,
    DeleteVideoReviewCommentFeature,
    UpdateVideoReviewCommentFeature,
} from './video-review-comment.feature'
import {
    AddVideoReviewCommentHandler,
    DeleteVideoReviewCommentHandler,
    UpdateVideoReviewCommentHandler,
} from './video-review-comment.handler'
import { REVIEW_ANSWERED_KIND, REVIEW_REQUESTED_KIND } from './video-review-notifications'
import { MAX_REVIEW_CLIP_BYTES } from './video-reviews-utils'

// ---- an in-memory club -------------------------------------------------

const W = 'w1'
const OWNER = 'owner'
// Members: two students and a coach; `gone` left the club.
const A = 'member-a'
const B = 'member-b'
const COACH = 'coach'
const COACH2 = 'coach2'

const day = (n: number) => new Date(`2026-04-${String(n).padStart(2, '0')}T10:00:00Z`)

type Clip = {
    id: string
    workspaceId: string
    ownerUserId: string
    status: string
    errorMessage: string | null
    rawBucket: string
    rawKey: string
    hlsBucket: string
    hlsMasterKey: string | null
    thumbnailKey: string | null
    duration: number | null
    sizeBytes: bigint | null
}
type Request = {
    id: string
    workspaceId: string
    clipId: string
    memberUserId: string
    title: string
    message: string | null
    status: string
    createdAt: Date
    updatedAt: Date
}
type Comment = {
    id: string
    requestId: string
    authorUserId: string
    atSec: number
    endSec: number | null
    text: string
    drawing: unknown
    createdAt: Date
    updatedAt: Date
}

const clip = (id: string, over: Partial<Clip> = {}): Clip => ({
    id,
    workspaceId: W,
    ownerUserId: A,
    status: 'ready',
    errorMessage: null,
    rawBucket: 'bucket',
    rawKey: `raw/review/${id}/source`,
    hlsBucket: 'bucket',
    hlsMasterKey: `hls/review/${id}/master.m3u8`,
    thumbnailKey: `hls/review/${id}/thumbnail.jpg`,
    duration: 120,
    sizeBytes: null,
    ...over,
})

const request = (id: string, over: Partial<Request> = {}): Request => ({
    id,
    workspaceId: W,
    clipId: `clip-${id}`,
    memberUserId: A,
    title: `Sparring ${id}`,
    message: null,
    status: 'open',
    createdAt: day(1),
    updatedAt: day(1),
    ...over,
})

const comment = (id: string, over: Partial<Comment> = {}): Comment => ({
    id,
    requestId: 'r1',
    authorUserId: COACH,
    atSec: 10,
    endSec: null,
    text: 'Elbow in',
    drawing: null,
    createdAt: day(2),
    updatedAt: day(2),
    ...over,
})

const users: Record<string, { firstname: string | null; lastname: string | null }> = {
    [A]: { firstname: 'Анна', lastname: 'Смирнова' },
    [B]: { firstname: 'Борис', lastname: null },
    [COACH]: { firstname: 'Иван', lastname: 'Тренер' },
    [COACH2]: { firstname: 'Пётр', lastname: null },
    [OWNER]: { firstname: null, lastname: null },
}

const DRAWING = {
    strokes: [{ tool: 'arrow', color: 'red', points: [0.1, 0.1, 0.5, 0.5] }],
}

const build = (
    o: {
        clips?: Clip[]
        requests?: Request[]
        comments?: Comment[]
        members?: Record<string, { status: string; accessUntil: Date | null; role: string }>
        objectSize?: number | null
        // The coaches of the groups the uploading member is in.
        groupCoaches?: string[]
    } = {},
) => {
    const clips = o.clips ?? [clip('clip-r1')]
    const requests = o.requests ?? [request('r1')]
    const comments = o.comments ?? []
    const members = o.members ?? {
        [A]: { status: 'ACTIVE', accessUntil: null, role: 'user' },
        [B]: { status: 'ACTIVE', accessUntil: null, role: 'user' },
        [COACH]: { status: 'ACTIVE', accessUntil: null, role: 'coach' },
        [COACH2]: { status: 'ACTIVE', accessUntil: null, role: 'coach' },
    }
    let seq = 0
    const who = (id: string) => ({ id, ...users[id] })
    const withRelations = (r: Request) => ({
        ...r,
        member: who(r.memberUserId),
        clip: clips.find((c) => c.id === r.clipId)!,
        _count: { comments: comments.filter((c) => c.requestId === r.id).length },
    })
    const prisma = {
        workspace: {
            findUnique: jest.fn(async () => ({ ownerId: OWNER, type: 'GRAPPLING' })),
        },
        groupCoach: {
            findMany: jest.fn(async () => (o.groupCoaches ?? []).map((userId) => ({ userId }))),
        },
        workspaceMember: {
            findUnique: jest.fn(
                async (args: { where: { userId_workspaceId: { userId: string } } }) => {
                    const m = members[args.where.userId_workspaceId.userId]
                    return m ? { ...m, role: { name: m.role } } : null
                },
            ),
        },
        reviewClip: {
            create: jest.fn(async ({ data }: { data: Partial<Clip> }) => {
                const row = clip(data.id!, {
                    ...data,
                    hlsMasterKey: null,
                    thumbnailKey: null,
                    duration: null,
                })
                clips.push(row)
                return row
            }),
            findUnique: jest.fn(
                async ({ where }: { where: { id: string } }) =>
                    clips.find((c) => c.id === where.id) ?? null,
            ),
            update: jest.fn(
                async ({ where, data }: { where: { id: string }; data: Partial<Clip> }) => {
                    const row = clips.find((c) => c.id === where.id)!
                    Object.assign(row, data)
                    return row
                },
            ),
            delete: jest.fn(async ({ where }: { where: { id: string } }) => {
                clips.splice(clips.findIndex((c) => c.id === where.id), 1)
                // FK cascade.
                for (const r of requests.filter((x) => x.clipId === where.id)) {
                    requests.splice(requests.indexOf(r), 1)
                }
            }),
        },
        videoReviewRequest: {
            count: jest.fn(
                async ({ where }: { where: { memberUserId: string; workspaceId: string } }) =>
                    requests.filter(
                        (r) =>
                            r.memberUserId === where.memberUserId &&
                            r.workspaceId === where.workspaceId &&
                            r.status !== 'closed',
                    ).length,
            ),
            create: jest.fn(async ({ data }: { data: Partial<Request> }) => {
                const row = request(`new-${++seq}`, { ...data, createdAt: day(9), updatedAt: day(9) })
                requests.push(row)
                return withRelations(row)
            }),
            findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
                const r = requests.find((x) => x.id === where.id)
                return r ? withRelations(r) : null
            }),
            findMany: jest.fn(
                async ({
                    where,
                }: {
                    where: {
                        workspaceId: string
                        memberUserId?: string
                        status?: string
                        clip?: { status: { not: string } }
                    }
                }) =>
                    requests
                        .filter(
                            (r) =>
                                r.workspaceId === where.workspaceId &&
                                (!where.memberUserId || r.memberUserId === where.memberUserId) &&
                                (!where.status || r.status === where.status) &&
                                (!where.clip ||
                                    clips.find((c) => c.id === r.clipId)!.status !==
                                        where.clip.status.not),
                        )
                        .map(withRelations),
            ),
            update: jest.fn(
                async ({ where, data }: { where: { id: string }; data: Partial<Request> }) => {
                    const row = requests.find((r) => r.id === where.id)!
                    Object.assign(row, data, { updatedAt: day(20) })
                    return withRelations(row)
                },
            ),
        },
        videoReviewComment: {
            findMany: jest.fn(async ({ where }: { where: { requestId: string } }) =>
                comments
                    .filter((c) => c.requestId === where.requestId)
                    .sort((a, b) => a.atSec - b.atSec)
                    .map((c) => ({ ...c, author: who(c.authorUserId) })),
            ),
            findUnique: jest.fn(
                async ({ where }: { where: { id: string } }) =>
                    comments.find((c) => c.id === where.id) ?? null,
            ),
            create: jest.fn(async ({ data }: { data: Partial<Comment> }) => {
                const row = comment(`c-new-${++seq}`, data)
                comments.push(row)
                return row
            }),
            update: jest.fn(
                async ({ where, data }: { where: { id: string }; data: Partial<Comment> }) => {
                    const row = comments.find((c) => c.id === where.id)!
                    Object.assign(row, data)
                    return row
                },
            ),
            delete: jest.fn(async ({ where }: { where: { id: string } }) => {
                comments.splice(comments.findIndex((c) => c.id === where.id), 1)
            }),
        },
        $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    }
    const files = {
        getMaxVideoUploadBytes: jest.fn(() => 2 * 1024 ** 3),
        getDefaultBucketName: jest.fn(() => 'bucket'),
        getPresignedPutUrl: jest.fn(async (p: { key: string }) => ({
            url: `put:${p.key}`,
            method: 'PUT' as const,
        })),
        getPresignedGetUrl: jest.fn(async (p: { key: string }) => `get:${p.key}`),
        getObjectSize: jest.fn(async () => (o.objectSize === undefined ? 1000 : o.objectSize)),
        deleteObject: jest.fn(async () => undefined),
        deleteObjectsByPrefix: jest.fn(async () => undefined),
        getObjectText: jest.fn(async () => '#EXTM3U\nseg0.ts'),
    }
    const notifications = {
        notifyWorkspace: jest.fn(async () => 1),
        notifyUser: jest.fn(async () => true),
    }
    const transcode = { enqueueReviewClip: jest.fn(async () => undefined) }
    return { prisma, files, notifications, transcode, clips, requests, comments }
}

type Deps = ReturnType<typeof build>
const p = (d: Deps) => d.prisma as never
const fl = (d: Deps) => d.files as never

const STAFF = true
const MEMBER = false

const get = (d: Deps, userId: string, isStaff = false, requestId = 'r1') =>
    new GetVideoReviewHandler(p(d), fl(d)).execute(
        new GetVideoReviewFeature(userId, W, isStaff, requestId),
    )

// ---- the member's side -------------------------------------------------

describe('CreateMyVideoReviewHandler', () => {
    const create = (d: Deps, over: Record<string, unknown> = {}, userId = A) =>
        new CreateMyVideoReviewHandler(p(d), fl(d)).execute(
            new CreateMyVideoReviewFeature(userId, W, {
                title: 'Guard passing',
                message: '',
                contentType: 'video/mp4',
                sizeBytes: 5000,
                ...over,
            } as never),
        )

    it('creates the clip and the request and signs the upload', async () => {
        const d = build({ clips: [], requests: [] })
        const res = await create(d)
        const clipRow = d.clips[0]
        expect(clipRow).toMatchObject({
            workspaceId: W,
            ownerUserId: A,
            status: 'uploading',
            rawKey: `raw/review/${clipRow.id}/source`,
        })
        expect(d.requests[0]).toMatchObject({
            clipId: clipRow.id,
            memberUserId: A,
            title: 'Guard passing',
            message: null,
        })
        expect(d.files.getPresignedPutUrl).toHaveBeenCalledWith({
            bucket: 'bucket',
            key: `raw/review/${clipRow.id}/source`,
            contentType: 'video/mp4',
            contentLength: 5000,
        })
        expect(res).toMatchObject({
            request: { status: 'uploading', member: { id: A, name: 'Анна Смирнова' } },
            upload: { method: 'PUT' },
        })
    })

    it("refuses a user who isn't an active member", async () => {
        const d = build({ members: {} })
        await expect(create(d)).rejects.toBeInstanceOf(ForbiddenError)
        expect(d.prisma.reviewClip.create).not.toHaveBeenCalled()
    })

    it("respects the server's smaller upload limit", async () => {
        const d = build()
        d.files.getMaxVideoUploadBytes.mockReturnValue(1000)
        await expect(create(d, { sizeBytes: 1001 })).rejects.toBeInstanceOf(BadRequestError)
        expect(d.prisma.reviewClip.create).not.toHaveBeenCalled()
        expect(MAX_REVIEW_CLIP_BYTES).toBeLessThan(2 * 1024 ** 3)
    })

    it(`refuses more than ${MAX_ACTIVE_REVIEWS} waiting requests`, async () => {
        const many = Array.from({ length: MAX_ACTIVE_REVIEWS }, (_, i) => request(`r${i}`))
        const d = build({ requests: many })
        await expect(create(d)).rejects.toBeInstanceOf(BadRequestError)
    })
})

describe('CompleteMyVideoReviewUploadHandler', () => {
    const uploading = () => ({
        clips: [clip('clip-r1', { status: 'uploading', hlsMasterKey: null, thumbnailKey: null })],
    })
    const complete = (d: Deps, userId = A, requestId = 'r1') =>
        new CompleteMyVideoReviewUploadHandler(
            p(d),
            fl(d),
            d.transcode as never,
            d.notifications as never,
        ).execute(new CompleteMyVideoReviewUploadFeature(userId, W, requestId))

    it('measures the upload, queues the transcode and tells all staff of a member in no group', async () => {
        const d = build(uploading())
        const res = await complete(d)
        expect(d.clips[0]).toMatchObject({ status: 'uploaded', sizeBytes: BigInt(1000) })
        expect(d.transcode.enqueueReviewClip).toHaveBeenCalledWith('clip-r1')
        expect(res.status).toBe('processing')
        expect(d.prisma.groupCoach.findMany).toHaveBeenCalledWith({
            where: { group: { workspaceId: W, members: { some: { userId: A } } } },
            select: { userId: true },
        })
        expect(d.notifications.notifyWorkspace).toHaveBeenCalledWith({
            workspaceId: W,
            kind: REVIEW_REQUESTED_KIND,
            refId: 'r1',
            topic: 'Новый разбор от Анна Смирнова',
            message: 'Sparring r1',
            metadata: { requestId: 'r1' },
            memberWhere: {
                role: { name: { in: ['admin', 'head_coach', 'coach'] } },
                userId: { notIn: [A, OWNER] },
            },
        })
        expect(d.notifications.notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({ userId: OWNER, refId: 'r1:owner' }),
        )
    })

    it("tells only the member's group coaches (deduped) and the head coaches", async () => {
        const d = build({ ...uploading(), groupCoaches: [COACH, COACH, OWNER] })
        await complete(d)
        expect(d.notifications.notifyWorkspace).toHaveBeenCalledWith(
            expect.objectContaining({
                memberWhere: {
                    userId: { notIn: [A, OWNER] },
                    OR: [
                        { role: { name: 'head_coach' } },
                        {
                            role: { name: { in: ['admin', 'head_coach', 'coach'] } },
                            userId: { in: [COACH, OWNER] },
                        },
                    ],
                },
            }),
        )
        expect(d.notifications.notifyUser).toHaveBeenCalledTimes(1)
        expect(d.notifications.notifyUser).toHaveBeenCalledWith(
            expect.objectContaining({ userId: OWNER, refId: 'r1:owner' }),
        )
    })

    it('never tells the sender, even a coach in their own group', async () => {
        const d = build({
            clips: [clip('clip-r1', { status: 'uploading', ownerUserId: COACH, hlsMasterKey: null, thumbnailKey: null })],
            requests: [request('r1', { memberUserId: COACH })],
            groupCoaches: [COACH, COACH2],
        })
        await complete(d, COACH)
        const [[arg]] = d.notifications.notifyWorkspace.mock.calls as unknown as [[{ memberWhere: { userId: { notIn: string[] } } }]]
        expect(arg.memberWhere.userId.notIn).toContain(COACH)
    })

    it.each([
        ['another member', B],
        ['a coach', COACH],
    ])("404s for %s (completing is the member's)", async (_, userId) => {
        const d = build(uploading())
        await expect(complete(d, userId)).rejects.toBeInstanceOf(NotFoundError)
        expect(d.transcode.enqueueReviewClip).not.toHaveBeenCalled()
    })

    it("404s a request of another club", async () => {
        const d = build({ ...uploading(), requests: [request('r1', { workspaceId: 'w2' })] })
        await expect(complete(d)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('does nothing more for a repeated complete', async () => {
        const d = build()
        await expect(complete(d)).resolves.toMatchObject({ status: 'open' })
        expect(d.transcode.enqueueReviewClip).not.toHaveBeenCalled()
        expect(d.notifications.notifyWorkspace).not.toHaveBeenCalled()
    })

    it('refuses when nothing was uploaded', async () => {
        const d = build({ ...uploading(), objectSize: null })
        await expect(complete(d)).rejects.toBeInstanceOf(BadRequestError)
        expect(d.clips[0].status).toBe('uploading')
    })

    it('fails and deletes an oversized upload', async () => {
        const d = build({ ...uploading(), objectSize: MAX_REVIEW_CLIP_BYTES + 1 })
        await expect(complete(d)).rejects.toBeInstanceOf(BadRequestError)
        expect(d.clips[0].status).toBe('failed')
        expect(d.files.deleteObject).toHaveBeenCalledWith({
            bucket: 'bucket',
            key: 'raw/review/clip-r1/source',
        })
        expect(d.transcode.enqueueReviewClip).not.toHaveBeenCalled()
    })
})

describe('ListMyVideoReviewsHandler', () => {
    it("lists only the member's own requests in this club", async () => {
        const d = build({
            clips: [clip('clip-r1'), clip('clip-r2', { ownerUserId: B }), clip('clip-r3')],
            requests: [
                request('r1'),
                request('r2', { memberUserId: B }),
                request('r3', { workspaceId: 'w2' }),
            ],
        })
        const res = await new ListMyVideoReviewsHandler(p(d), fl(d)).execute(
            new ListMyVideoReviewsFeature(A, W),
        )
        expect(res.items.map((i) => i.id)).toEqual(['r1'])
        expect(res.items[0].clip.thumbnailUrl).toBe('get:hls/review/clip-r1/thumbnail.jpg')
    })
})

describe('DeleteMyVideoReviewHandler', () => {
    const remove = (d: Deps, userId: string) =>
        new DeleteMyVideoReviewHandler(p(d), fl(d)).execute(
            new DeleteMyVideoReviewFeature(userId, W, 'r1'),
        )

    it('removes the files and the clip (the request goes with it)', async () => {
        const d = build()
        await expect(remove(d, A)).resolves.toEqual({ status: 'deleted' })
        expect(d.files.deleteObjectsByPrefix.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
            { bucket: 'bucket', prefix: 'raw/review/clip-r1/' },
            { bucket: 'bucket', prefix: 'hls/review/clip-r1/' },
        ])
        expect(d.clips).toEqual([])
        expect(d.requests).toEqual([])
    })

    it.each([
        ['another member', B],
        ['a coach', COACH],
    ])('404s for %s and deletes nothing', async (_, userId) => {
        const d = build()
        await expect(remove(d, userId)).rejects.toBeInstanceOf(NotFoundError)
        expect(d.files.deleteObjectsByPrefix).not.toHaveBeenCalled()
        expect(d.clips).toHaveLength(1)
    })
})

// ---- the coach's side and shared reads ----------------------------------

describe('ListClubVideoReviewsHandler', () => {
    const list = (d: Deps, isStaff: boolean, status?: 'open' | 'answered' | 'closed') =>
        new ListClubVideoReviewsHandler(p(d), fl(d)).execute(
            new ListClubVideoReviewsFeature(COACH, W, isStaff, { status }),
        )

    it('refuses a member', async () => {
        await expect(list(build(), MEMBER)).rejects.toBeInstanceOf(ForbiddenError)
    })

    it('shows waiting requests first (oldest first), then the rest newest first', async () => {
        const d = build({
            clips: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) =>
                clip(`clip-${id}`, id === 'f' ? { status: 'uploading' } : {}),
            ),
            requests: [
                request('a', { status: 'answered', createdAt: day(1) }),
                request('b', { status: 'open', createdAt: day(5) }),
                request('c', { status: 'open', createdAt: day(2) }),
                request('d', { status: 'answered', createdAt: day(4) }),
                request('e', { status: 'closed', createdAt: day(6) }),
                // Still uploading: not a request yet.
                request('f', { status: 'open', createdAt: day(1) }),
            ],
        })
        const res = await list(d, STAFF)
        expect(res.items.map((i) => i.id)).toEqual(['c', 'b', 'd', 'a', 'e'])
    })

    it('filters by status', async () => {
        const d = build({
            clips: [clip('clip-a'), clip('clip-b')],
            requests: [request('a'), request('b', { status: 'closed' })],
        })
        expect((await list(d, STAFF, 'closed')).items.map((i) => i.id)).toEqual(['b'])
    })
})

describe('GetVideoReviewHandler', () => {
    const withComments = () =>
        build({
            comments: [
                comment('late', { atSec: 90, authorUserId: COACH2 }),
                comment('early', { atSec: 5, drawing: DRAWING }),
            ],
        })

    it('shows the member their request with comments in time order', async () => {
        const res = await get(withComments(), A, MEMBER)
        expect(res).toMatchObject({
            id: 'r1',
            status: 'open',
            viewerIsOwner: true,
            viewerIsStaff: false,
        })
        expect(res.comments.map((c) => [c.id, c.mine, c.author.name])).toEqual([
            ['early', false, 'Иван Тренер'],
            ['late', false, 'Пётр'],
        ])
        expect(res.comments[0].drawing).toEqual(DRAWING)
    })

    it('shows a coach the request, marking their own comments', async () => {
        const res = await get(withComments(), COACH, STAFF)
        expect(res.viewerIsStaff).toBe(true)
        expect(res.comments.map((c) => c.mine)).toEqual([true, false])
    })

    it("404s another member's request", async () => {
        await expect(get(build(), B, MEMBER)).rejects.toBeInstanceOf(NotFoundError)
    })

    it('404s a request of another club, even for staff', async () => {
        const d = build({ requests: [request('r1', { workspaceId: 'w2' })] })
        await expect(get(d, COACH, STAFF)).rejects.toBeInstanceOf(NotFoundError)
    })

    it("refuses someone who isn't an active member", async () => {
        const d = build({
            members: { [A]: { status: 'ACTIVE', accessUntil: day(1), role: 'user' } },
        })
        await expect(get(d, A, MEMBER)).rejects.toBeInstanceOf(ForbiddenError)
    })
})

describe('GetVideoReviewPlaybackHandler', () => {
    const playback = (d: Deps, userId: string, isStaff: boolean) =>
        new GetVideoReviewPlaybackHandler(p(d)).execute(
            new GetVideoReviewPlaybackFeature(userId, W, isStaff, 'r1'),
        )

    it('signs a clip-bound token for the member and for staff', async () => {
        for (const [userId, isStaff] of [
            [A, MEMBER],
            [COACH, STAFF],
        ] as const) {
            const { hlsUrl } = await playback(build(), userId, isStaff)
            expect(hlsUrl).toContain('/review-clips/clip-r1/manifest.m3u8?token=')
            const token = decodeURIComponent(hlsUrl.split('token=')[1])
            expect(verifyPlaybackToken(token)).toMatchObject({
                videoId: 'review-clip-r1',
                userId,
            })
        }
    })

    it('refuses while the clip is processing', async () => {
        const d = build({ clips: [clip('clip-r1', { status: 'processing', hlsMasterKey: null })] })
        await expect(playback(d, A, MEMBER)).rejects.toBeInstanceOf(BadRequestError)
    })

    it("404s another member's clip", async () => {
        await expect(playback(build(), B, MEMBER)).rejects.toBeInstanceOf(NotFoundError)
    })
})

describe('SetVideoReviewStatusHandler', () => {
    const setStatus = (
        d: Deps,
        userId: string,
        isStaff: boolean,
        status: 'open' | 'answered' | 'closed',
    ) =>
        new SetVideoReviewStatusHandler(p(d), fl(d), d.notifications as never).execute(
            new SetVideoReviewStatusFeature(userId, W, isStaff, 'r1', { status }),
        )

    it('a coach marks it answered and the member hears «Тренер ответил»', async () => {
        const d = build()
        const res = await setStatus(d, COACH, STAFF, 'answered')
        expect(res.status).toBe('answered')
        expect(d.notifications.notifyUser).toHaveBeenCalledWith({
            userId: A,
            kind: REVIEW_ANSWERED_KIND,
            refId: `r1:${day(20).toISOString()}`,
            topic: 'Тренер ответил',
            message: 'Sparring r1',
            metadata: { requestId: 'r1' },
            workspaceId: W,
        })
    })

    it('the member may close or reopen, but not mark it answered', async () => {
        const d = build()
        await expect(setStatus(d, A, MEMBER, 'answered')).rejects.toBeInstanceOf(ForbiddenError)
        await expect(setStatus(d, A, MEMBER, 'closed')).resolves.toMatchObject({
            status: 'closed',
        })
        await expect(setStatus(d, A, MEMBER, 'open')).resolves.toMatchObject({ status: 'open' })
        expect(d.notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('changes nothing when the status is already that', async () => {
        const d = build()
        await setStatus(d, COACH, STAFF, 'open')
        expect(d.prisma.videoReviewRequest.update).not.toHaveBeenCalled()
    })

    it("doesn't notify a coach answering their own clip", async () => {
        const d = build({
            clips: [clip('clip-r1', { ownerUserId: COACH })],
            requests: [request('r1', { memberUserId: COACH })],
        })
        await setStatus(d, COACH, STAFF, 'answered')
        expect(d.notifications.notifyUser).not.toHaveBeenCalled()
    })

    it('refuses before the clip is ready', async () => {
        const d = build({ clips: [clip('clip-r1', { status: 'processing' })] })
        await expect(setStatus(d, COACH, STAFF, 'answered')).rejects.toBeInstanceOf(
            BadRequestError,
        )
    })

    it("404s another member's request", async () => {
        await expect(setStatus(build(), B, MEMBER, 'closed')).rejects.toBeInstanceOf(
            NotFoundError,
        )
    })
})

describe('video review comments', () => {
    const add = (d: Deps, payload: Record<string, unknown>, userId = COACH, isStaff = STAFF) =>
        new AddVideoReviewCommentHandler(p(d), fl(d)).execute(
            new AddVideoReviewCommentFeature(userId, W, isStaff, 'r1', {
                atSec: 30,
                endSec: null,
                text: 'Hips higher',
                drawing: null,
                ...payload,
            } as never),
        )
    const update = (d: Deps, commentId: string, payload: Record<string, unknown>, userId = COACH) =>
        new UpdateVideoReviewCommentHandler(p(d), fl(d)).execute(
            new UpdateVideoReviewCommentFeature(userId, W, STAFF, 'r1', commentId, payload as never),
        )
    const remove = (d: Deps, commentId: string, userId = COACH) =>
        new DeleteVideoReviewCommentHandler(p(d), fl(d)).execute(
            new DeleteVideoReviewCommentFeature(userId, W, STAFF, 'r1', commentId),
        )

    it('a coach pins a comment with a drawing to a moment', async () => {
        const d = build()
        const res = await add(d, { endSec: 40, drawing: DRAWING })
        expect(d.comments[0]).toMatchObject({
            requestId: 'r1',
            authorUserId: COACH,
            atSec: 30,
            endSec: 40,
            drawing: DRAWING,
        })
        expect(res.comments[0]).toMatchObject({ mine: true, text: 'Hips higher' })
    })

    it('stores no drawing as a database null', async () => {
        const d = build()
        await add(d, {})
        const data = d.prisma.videoReviewComment.create.mock.calls[0][0].data
        expect(data.drawing).toBe(Prisma.DbNull)
    })

    it('refuses the member (comments are the staff’s)', async () => {
        const d = build()
        await expect(add(d, {}, A, MEMBER)).rejects.toBeInstanceOf(ForbiddenError)
        expect(d.comments).toEqual([])
    })

    it("404s a coach of another club's request", async () => {
        const d = build({ requests: [request('r1', { workspaceId: 'w2' })] })
        await expect(add(d, {})).rejects.toBeInstanceOf(NotFoundError)
    })

    it.each([
        ['an end before the start', { atSec: 30, endSec: 30 }],
        ['a moment past the end of the clip', { atSec: 121 }],
        ['a segment past the end of the clip', { atSec: 100, endSec: 130 }],
    ])('refuses %s', async (_, payload) => {
        const d = build()
        await expect(add(d, payload)).rejects.toBeInstanceOf(BadRequestError)
        expect(d.comments).toEqual([])
    })

    it('refuses while the clip is processing', async () => {
        const d = build({ clips: [clip('clip-r1', { status: 'processing' })] })
        await expect(add(d, {})).rejects.toBeInstanceOf(BadRequestError)
    })

    it('a coach edits their own comment; the range is checked after merging', async () => {
        const d = build({ comments: [comment('c1', { atSec: 10, endSec: 20, drawing: DRAWING })] })
        const res = await update(d, 'c1', { text: 'Elbow tight', drawing: null })
        expect(res.comments[0]).toMatchObject({ text: 'Elbow tight', drawing: null, endSec: 20 })
        await expect(update(d, 'c1', { atSec: 25 })).rejects.toBeInstanceOf(BadRequestError)
    })

    it("refuses to change another coach's comment", async () => {
        const d = build({ comments: [comment('c1', { authorUserId: COACH2 })] })
        await expect(update(d, 'c1', { text: 'x' })).rejects.toBeInstanceOf(ForbiddenError)
        await expect(remove(d, 'c1')).rejects.toBeInstanceOf(ForbiddenError)
        expect(d.comments).toHaveLength(1)
    })

    it('404s a comment of another request', async () => {
        const d = build({ comments: [comment('c1', { requestId: 'r2' })] })
        await expect(remove(d, 'c1')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('deletes its own comment', async () => {
        const d = build({ comments: [comment('c1')] })
        const res = await remove(d, 'c1')
        expect(res.comments).toEqual([])
    })
})

describe('ReviewClipManifestController', () => {
    const manifest = (d: Deps, token: string | undefined, path?: string) =>
        new ReviewClipManifestController(p(d), fl(d)).getReviewClipManifest(
            'clip-r1',
            token,
            path,
        )
    const tokenFor = (userId: string, subject = 'review-clip-r1') =>
        issuePlaybackToken({ videoId: subject, userId })

    it.each([
        ['the member', A],
        ['a coach', COACH],
        ['the club owner', OWNER],
    ])('serves the playlist to %s', async (_, userId) => {
        const d = build()
        await expect(manifest(d, tokenFor(userId))).resolves.toBe(
            '#EXTM3U\nget:hls/review/clip-r1/seg0.ts',
        )
    })

    it('refuses no token, a club video token and a token for another clip', async () => {
        const d = build()
        for (const token of [undefined, tokenFor(A, 'clip-r1'), tokenFor(A, 'review-other')]) {
            await expect(manifest(d, token)).rejects.toBeInstanceOf(HttpException)
        }
        expect(d.files.getObjectText).not.toHaveBeenCalled()
    })

    it.each([
        ['another member', B],
        ['someone who left the club', 'gone'],
    ])('refuses %s even with a valid token', async (_, userId) => {
        const d = build()
        await expect(manifest(d, tokenFor(userId))).rejects.toMatchObject({ status: 403 })
    })

    it('refuses a coach whose access window expired', async () => {
        const d = build({
            members: { [COACH]: { status: 'ACTIVE', accessUntil: day(1), role: 'coach' } },
        })
        await expect(manifest(d, tokenFor(COACH))).rejects.toMatchObject({ status: 403 })
    })

    it('refuses a path outside the clip', async () => {
        const d = build()
        await expect(
            manifest(d, tokenFor(A), encodeURIComponent('hls/other/master.m3u8')),
        ).rejects.toMatchObject({ status: 400 })
    })
})
