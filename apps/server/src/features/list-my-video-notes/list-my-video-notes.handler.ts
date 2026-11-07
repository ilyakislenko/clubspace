import { Feature, IFeatureHandler } from '@shelfjs/features'

import { CourseAccessService } from '../../domains/playlist/services/course-access.service'
import { visibleVideoCourseSelect } from '../../domains/playlist/services/video-course-pick'
import { PrismaService } from '../../infrastructure/prisma'
import { serializeMyVideoBookmark } from '../manage-my-video-bookmarks/schemas'
import {
    ListMyVideoNotesFeature,
    ListMyVideoNotesFeatureResponse,
} from './list-my-video-notes.feature'

type Item = ListMyVideoNotesFeatureResponse['items'][number]

@Feature(ListMyVideoNotesFeature)
export class ListMyVideoNotesHandler
    implements
        IFeatureHandler<ListMyVideoNotesFeature, ListMyVideoNotesFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly courseAccess: CourseAccessService,
    ) {}

    async execute({
        userId,
        workspaceId,
        payload,
        isStaff,
    }: ListMyVideoNotesFeature) {
        const [notes, bookmarks] = await Promise.all([
            this.prisma.videoNote.findMany({
                where: { userId, workspaceId, text: { not: '' } },
            }),
            this.prisma.videoBookmark.findMany({
                where: { userId, workspaceId, deletedAt: null },
                orderBy: [{ positionSec: 'asc' }, { createdAt: 'asc' }],
            }),
        ])

        const videoIds = [
            ...new Set([
                ...notes.map((n) => n.videoId),
                ...bookmarks.map((b) => b.videoId),
            ]),
        ]
        if (videoIds.length === 0) return { items: [] }

        const viewer = await this.courseAccess.loadViewer({
            workspaceId,
            userId,
            isStaff,
        })
        const videos = await this.prisma.video.findMany({
            where: { id: { in: videoIds }, workspaceId },
            select: {
                id: true,
                title: true,
                thumbnailUrl: true,
                duration: true,
                // Only a course this viewer could open from the course list.
                courses: visibleVideoCourseSelect(viewer),
            },
        })

        const q = payload.q?.trim().toLowerCase() ?? ''
        const matches = (s: string) => s.toLowerCase().includes(q)

        const rows: { activity: number; item: Item }[] = []
        for (const video of videos) {
            const note = notes.find((n) => n.videoId === video.id) ?? null
            const own = bookmarks.filter((b) => b.videoId === video.id)
            if (
                q &&
                !matches(video.title) &&
                !(note && matches(note.text)) &&
                !own.some((b) => matches(b.label) || matches(b.note))
            ) {
                continue
            }
            const activity = Math.max(
                note?.updatedAt.getTime() ?? 0,
                ...own.map((b) => b.updatedAt.getTime()),
            )
            const course = video.courses[0]?.course ?? null
            rows.push({
                activity,
                item: {
                    video: {
                        id: video.id,
                        title: video.title,
                        thumbnailUrl: video.thumbnailUrl,
                        duration: video.duration,
                    },
                    course: course ? { id: course.id, title: course.title } : null,
                    note: note
                        ? { text: note.text, updatedAt: note.updatedAt.toISOString() }
                        : null,
                    bookmarks: own.map(serializeMyVideoBookmark),
                },
            })
        }

        rows.sort((a, b) => b.activity - a.activity)
        return { items: rows.map((r) => r.item) }
    }
}
