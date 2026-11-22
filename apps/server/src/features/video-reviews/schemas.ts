import { z } from 'zod'

import { FilesService } from '../../infrastructure/files/services/files.service'
import { Prisma, PrismaService } from '../../infrastructure/prisma'
import { assertActiveWorkspaceMembership } from '../../shared/access/assert-membership'
import { NotFoundError } from '../../shared/errors/shared.errors'
import type { RbacService } from '../../shared/services/rbac.service'
import { fullNameWithoutEmail } from '../../shared/utils/person-name'
import {
    BookmarkDrawingSchema,
    parseStoredDrawing,
} from '../manage-my-video-bookmarks/drawing'
import {
    resolveReviewStaffScope,
    type ReviewViewerRole,
    staffCanSeeMemberReviews,
} from './review-clip-access'
import { displayStatus } from './video-reviews-utils'

// The comment drawing has the bookmark drawing's shape and limits.
export const ReviewDrawingSchema = BookmarkDrawingSchema

// Cover links live this long (the lists refetch far more often).
const THUMBNAIL_URL_TTL_SECONDS = 60 * 60

const PersonSchema = z.object({ id: z.string().uuid(), name: z.string() })

export const VideoReviewSummarySchema = z.object({
    id: z.string().uuid(),
    title: z.string(),
    message: z.string().nullable(),
    // uploading / processing / failed come from the clip; then the request's.
    status: z.enum(['uploading', 'processing', 'failed', 'open', 'answered', 'closed']),
    member: PersonSchema,
    clip: z.object({
        id: z.string().uuid(),
        duration: z.number().int().nullable(),
        // Short-lived link to the private cover; null until transcoded.
        thumbnailUrl: z.string().nullable(),
        errorMessage: z.string().nullable(),
    }),
    commentCount: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

export const VideoReviewCommentSchema = z.object({
    id: z.string().uuid(),
    atSec: z.number().int(),
    endSec: z.number().int().nullable(),
    text: z.string(),
    drawing: ReviewDrawingSchema.nullable(),
    author: PersonSchema,
    // The viewer wrote it (may edit / delete).
    mine: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
})

export const VideoReviewDetailSchema = VideoReviewSummarySchema.extend({
    // Comments in time order.
    comments: z.array(VideoReviewCommentSchema),
    // What the viewer may do: the member owns the request; staff comment.
    viewerIsOwner: z.boolean(),
    viewerIsStaff: z.boolean(),
})

export type VideoReviewSummary = z.infer<typeof VideoReviewSummarySchema>
export type VideoReviewDetail = z.infer<typeof VideoReviewDetailSchema>

type Person = { id: string; firstname: string | null; lastname: string | null }

export const personSelect = { id: true, firstname: true, lastname: true } as const

export const person = (u: Person) => ({ id: u.id, name: fullNameWithoutEmail(u) })

type ClipRow = {
    id: string
    status: string
    duration: number | null
    thumbnailKey: string | null
    hlsBucket: string
    errorMessage: string | null
}

type RequestRow = {
    id: string
    title: string
    message: string | null
    status: string
    createdAt: Date
    updatedAt: Date
    member: Person
    clip: ClipRow
}

export const reviewSummaryInclude = {
    member: { select: personSelect },
    clip: true,
    _count: { select: { comments: true } },
} as const

export async function serializeReviewSummary(
    files: FilesService,
    row: RequestRow & { _count: { comments: number } },
): Promise<VideoReviewSummary> {
    const thumbnailUrl = row.clip.thumbnailKey
        ? await files.getPresignedGetUrl({
              bucket: row.clip.hlsBucket,
              key: row.clip.thumbnailKey,
              expiresInSeconds: THUMBNAIL_URL_TTL_SECONDS,
          })
        : null
    return {
        id: row.id,
        title: row.title,
        message: row.message,
        status: displayStatus(row.clip.status, row.status),
        member: person(row.member),
        clip: {
            id: row.clip.id,
            duration: row.clip.duration,
            thumbnailUrl,
            errorMessage: row.clip.status === 'failed' ? row.clip.errorMessage : null,
        },
        commentCount: row._count.comments,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }
}

export type ReviewWithClip = Prisma.VideoReviewRequestGetPayload<{
    include: typeof reviewSummaryInclude
}>
export type LoadedReview = { request: ReviewWithClip; isOwner: boolean; isStaff: boolean }

/**
 * The request as the viewer may see it: its member, or club staff allowed to
 * see that member's reviews (owner, admins, head coaches; a coach for their
 * own groups' members — staffCanSeeMemberReviews). Anyone else — another
 * member, another group's coach, another club — gets the same 404 as for a
 * request that doesn't exist. `isStaff` is whether the viewer acts on it as
 * staff.
 */
export async function loadReviewForViewer(
    prisma: PrismaService,
    rbac: RbacService,
    params: {
        requestId: string
        workspaceId: string
        userId: string
        viewer: ReviewViewerRole
    },
): Promise<LoadedReview> {
    await assertActiveWorkspaceMembership(prisma, params.userId, params.workspaceId)
    const request = await prisma.videoReviewRequest.findUnique({
        where: { id: params.requestId },
        include: reviewSummaryInclude,
    })
    if (!request || request.workspaceId !== params.workspaceId) {
        throw new NotFoundError({ message: 'Разбор не найден' })
    }
    const isOwner = request.memberUserId === params.userId
    const ctx = await resolveReviewStaffScope(rbac, params)
    const isStaff =
        ctx !== null &&
        (isOwner || (await staffCanSeeMemberReviews(rbac, prisma, ctx, request.memberUserId)))
    if (!isOwner && !isStaff) {
        throw new NotFoundError({ message: 'Разбор не найден' })
    }
    return { request, isOwner, isStaff }
}

export async function serializeReviewDetail(
    prisma: PrismaService,
    files: FilesService,
    loaded: LoadedReview,
    viewerId: string,
): Promise<VideoReviewDetail> {
    const comments = await prisma.videoReviewComment.findMany({
        where: { requestId: loaded.request.id },
        orderBy: [{ atSec: 'asc' }, { createdAt: 'asc' }],
        include: { author: { select: personSelect } },
    })
    const summary = await serializeReviewSummary(files, loaded.request)
    return {
        ...summary,
        comments: comments.map((c) => ({
            id: c.id,
            atSec: c.atSec,
            endSec: c.endSec,
            text: c.text,
            drawing: parseStoredDrawing(c.drawing),
            author: person(c.author),
            mine: c.authorUserId === viewerId,
            createdAt: c.createdAt.toISOString(),
            updatedAt: c.updatedAt.toISOString(),
        })),
        viewerIsOwner: loaded.isOwner,
        viewerIsStaff: loaded.isStaff,
    }
}
