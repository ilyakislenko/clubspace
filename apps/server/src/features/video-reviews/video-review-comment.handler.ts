import { Feature, IFeatureHandler } from '@shelfjs/features'

import { FilesService } from '../../infrastructure/files/services/files.service'
import { Prisma, PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { type LoadedReview, loadReviewForViewer, serializeReviewDetail } from './schemas'
import {
    AddVideoReviewCommentFeature,
    DeleteVideoReviewCommentFeature,
    UpdateVideoReviewCommentFeature,
    type VideoReviewCommentFeatureResponse,
} from './video-review-comment.feature'
import { isValidCommentRange } from './video-reviews-utils'

type CommentAccess = {
    userId: string
    workspaceId: string
    isStaff: boolean
    requestId: string
}

// Comments are the staff's: the member reads them. Only on a playable clip.
async function loadForComment(prisma: PrismaService, f: CommentAccess): Promise<LoadedReview> {
    const loaded = await loadReviewForViewer(prisma, f)
    if (!loaded.isStaff) {
        throw new ForbiddenError({ message: 'Комментировать разбор могут только тренеры клуба' })
    }
    if (loaded.request.clip.status !== 'ready') {
        throw new BadRequestError({ message: 'Видео ещё обрабатывается' })
    }
    return loaded
}

function assertRange(loaded: LoadedReview, atSec: number, endSec: number | null) {
    if (!isValidCommentRange(atSec, endSec)) {
        throw new BadRequestError({ message: 'Конец отрезка должен быть позже начала' })
    }
    const duration = loaded.request.clip.duration
    if (duration !== null && (atSec > duration || (endSec !== null && endSec > duration))) {
        throw new BadRequestError({ message: 'Момент за пределами видео' })
    }
}

// The viewer's own comment of this request; another coach's can't be changed.
async function loadOwnComment(prisma: PrismaService, f: CommentAccess & { commentId: string }) {
    const comment = await prisma.videoReviewComment.findUnique({ where: { id: f.commentId } })
    if (!comment || comment.requestId !== f.requestId) {
        throw new NotFoundError({ message: 'Комментарий не найден' })
    }
    if (comment.authorUserId !== f.userId) {
        throw new ForbiddenError({ message: 'Можно менять только свои комментарии' })
    }
    return comment
}

const drawingValue = (drawing: unknown) =>
    drawing === null ? Prisma.DbNull : (drawing as Prisma.InputJsonValue)

@Feature(AddVideoReviewCommentFeature)
export class AddVideoReviewCommentHandler
    implements IFeatureHandler<AddVideoReviewCommentFeature, VideoReviewCommentFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
    ) {}

    async execute(f: AddVideoReviewCommentFeature): Promise<VideoReviewCommentFeatureResponse> {
        const loaded = await loadForComment(this.prisma, f)
        const { atSec, endSec, text, drawing } = f.payload
        assertRange(loaded, atSec, endSec)
        await this.prisma.videoReviewComment.create({
            data: {
                requestId: loaded.request.id,
                authorUserId: f.userId,
                atSec,
                endSec,
                text,
                drawing: drawingValue(drawing),
            },
        })
        return await serializeReviewDetail(this.prisma, this.files, loaded, f.userId)
    }
}

@Feature(UpdateVideoReviewCommentFeature)
export class UpdateVideoReviewCommentHandler
    implements
        IFeatureHandler<UpdateVideoReviewCommentFeature, VideoReviewCommentFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
    ) {}

    async execute(
        f: UpdateVideoReviewCommentFeature,
    ): Promise<VideoReviewCommentFeatureResponse> {
        const loaded = await loadForComment(this.prisma, f)
        const comment = await loadOwnComment(this.prisma, f)
        const { atSec, endSec, text, drawing } = f.payload
        const nextAt = atSec ?? comment.atSec
        const nextEnd = endSec === undefined ? comment.endSec : endSec
        assertRange(loaded, nextAt, nextEnd)
        await this.prisma.videoReviewComment.update({
            where: { id: comment.id },
            data: {
                atSec: nextAt,
                endSec: nextEnd,
                ...(text !== undefined && { text }),
                ...(drawing !== undefined && { drawing: drawingValue(drawing) }),
            },
        })
        return await serializeReviewDetail(this.prisma, this.files, loaded, f.userId)
    }
}

@Feature(DeleteVideoReviewCommentFeature)
export class DeleteVideoReviewCommentHandler
    implements
        IFeatureHandler<DeleteVideoReviewCommentFeature, VideoReviewCommentFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly files: FilesService,
    ) {}

    async execute(
        f: DeleteVideoReviewCommentFeature,
    ): Promise<VideoReviewCommentFeatureResponse> {
        const loaded = await loadForComment(this.prisma, f)
        const comment = await loadOwnComment(this.prisma, f)
        await this.prisma.videoReviewComment.delete({ where: { id: comment.id } })
        return await serializeReviewDetail(this.prisma, this.files, loaded, f.userId)
    }
}
