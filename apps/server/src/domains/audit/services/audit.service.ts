import { Injectable, Logger } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'

// All actions follow `<entity>.<camelCaseVerb>` so audit-page filtering
// can split on the first dot reliably. Older mixed-format entries
// ('group.add_member', 'member.role.update', etc.) get rewritten by the
// one-shot migration in scripts/migrate-audit-action-names.sql.
export type AuditAction =
    | 'video.startUpload'
    | 'video.completeUpload'
    | 'video.update'
    | 'video.delete'
    | 'playlist.create'
    | 'playlist.update'
    | 'playlist.delete'
    | 'member.add'
    | 'member.remove'
    | 'member.updateAccess'
    | 'member.updateRole'
    | 'member.updateProfile'
    | 'content.report'
    | 'gym.create'
    | 'gym.update'
    | 'gym.delete'
    | 'group.create'
    | 'group.update'
    | 'group.delete'
    | 'group.addMember'
    | 'group.removeMember'
    | 'group.slotCreate'
    | 'group.slotUpdate'
    | 'group.slotDelete'
    | 'group.exceptionCreate'
    | 'group.exceptionUpdate'
    | 'group.exceptionDelete'
    | 'event.create'
    | 'event.update'
    | 'event.delete'
    | 'workspace.updateSettings'

export type AuditTargetType =
    | 'video'
    | 'playlist'
    | 'member'
    | 'workspace'
    | 'gym'
    | 'group'
    | 'event'

@Injectable()
export class AuditService {
    private readonly logger = new Logger(AuditService.name)

    constructor(private readonly prisma: PrismaService) {}

    async record(payload: {
        action: AuditAction
        targetType: AuditTargetType
        targetId?: string | null
        workspaceId?: string | null
        actorId?: string | null
        actorEmail?: string | null
        metadata?: Record<string, unknown>
    }) {
        try {
            await this.prisma.auditEvent.create({
                data: {
                    action: payload.action,
                    targetType: payload.targetType,
                    targetId: payload.targetId ?? null,
                    workspaceId: payload.workspaceId ?? null,
                    actorId: payload.actorId ?? null,
                    actorEmail: payload.actorEmail ?? null,
                    metadata: (payload.metadata ?? null) as never,
                },
            })
        } catch (error) {
            // Audit failures must never break the user request.
            this.logger.error(
                `Failed to record audit event ${payload.action}`,
                error instanceof Error ? error.stack : String(error),
            )
        }
    }

    async list(payload: {
        workspaceId: string
        curPage?: number
        perPage?: number
        // Coach-scoped readers narrow the visible events to: things they
        // did themselves, content events (videos/courses/playlists shared
        // by the whole workspace), and member/group events touching their
        // own students or groups. Pass an `extraOr` to plug those filters.
        extraOr?: Array<Record<string, unknown>>
    }) {
        const perPage = Math.min(payload.perPage ?? 50, 200)
        const curPage = Math.max(payload.curPage ?? 1, 1)
        const skip = (curPage - 1) * perPage

        const where = payload.extraOr
            ? { workspaceId: payload.workspaceId, OR: payload.extraOr }
            : { workspaceId: payload.workspaceId }

        const [data, total] = await this.prisma.$transaction([
            this.prisma.auditEvent.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: perPage,
            }),
            this.prisma.auditEvent.count({ where }),
        ])

        // Collect UUIDs by inferred type. We use the metadata key name
        // (e.g. `userId` -> user, `videoId` -> video) instead of pushing
        // every UUID into all three sets, which used to produce ghost
        // labels when a real userId happened to match a real videoId
        // (extremely unlikely in practice but the silent confusion was
        // hard to debug when it happened).
        const userIds = new Set<string>()
        const videoIds = new Set<string>()
        const courseIds = new Set<string>()

        const UUID_RE =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

        // Map metadata key names to the entity type they reference. Keys
        // outside the list are not auto-resolved; raw UUID stays raw,
        // which is the safe default.
        const userKeyHints = new Set([
            'userId',
            'invokerUserId',
            'invokerId',
            'targetUserId',
            'studentId',
            'coachId',
            'memberId',
            'fromUserId',
            'toUserId',
        ])
        const videoKeyHints = new Set([
            'videoId',
            'targetVideoId',
            'fromVideoId',
            'toVideoId',
        ])
        const courseKeyHints = new Set([
            'courseId',
            'playlistId',
            'targetCourseId',
        ])

        const collectIds = (raw: unknown) => {
            if (raw === null || raw === undefined) return
            if (Array.isArray(raw)) {
                raw.forEach(collectIds)
                return
            }
            if (typeof raw === 'object') {
                for (const [key, value] of Object.entries(
                    raw as Record<string, unknown>,
                )) {
                    if (typeof value === 'string' && UUID_RE.test(value)) {
                        if (userKeyHints.has(key)) userIds.add(value)
                        else if (videoKeyHints.has(key)) videoIds.add(value)
                        else if (courseKeyHints.has(key))
                            courseIds.add(value)
                    } else {
                        collectIds(value)
                    }
                }
            }
        }

        for (const event of data) {
            if (event.actorId) userIds.add(event.actorId)
            if (event.targetId) {
                if (event.targetType === 'video') videoIds.add(event.targetId)
                else if (event.targetType === 'playlist')
                    courseIds.add(event.targetId)
                else if (event.targetType === 'member')
                    userIds.add(event.targetId)
            }
            if (event.metadata) collectIds(event.metadata)
        }

        const [users, videos, courses] = await Promise.all([
            userIds.size > 0
                ? this.prisma.user.findMany({
                      where: { id: { in: Array.from(userIds) } },
                      select: {
                          id: true,
                          email: true,
                          firstname: true,
                          lastname: true,
                      },
                  })
                : [],
            videoIds.size > 0
                ? this.prisma.video.findMany({
                      where: { id: { in: Array.from(videoIds) } },
                      select: { id: true, title: true },
                  })
                : [],
            courseIds.size > 0
                ? this.prisma.course.findMany({
                      where: { id: { in: Array.from(courseIds) } },
                      select: { id: true, title: true },
                  })
                : [],
        ])

        const userLabel = (id: string): string | null => {
            const u = users.find((x) => x.id === id)
            if (!u) return null
            const name = [u.firstname, u.lastname].filter(Boolean).join(' ')
            return name.length > 0 ? `${name} (${u.email})` : u.email
        }
        const videoLabel = (id: string): string | null =>
            videos.find((x) => x.id === id)?.title ?? null
        const courseLabel = (id: string): string | null =>
            courses.find((x) => x.id === id)?.title ?? null

        // Replace UUIDs with a human label only when the metadata key
        // tells us what type they are. A bare UUID-shaped string with
        // no key context stays as-is — better to show a raw UUID than
        // silently pick the wrong entity type.
        const labelFor = (key: string, value: string): string | null => {
            if (userKeyHints.has(key)) return userLabel(value)
            if (videoKeyHints.has(key)) return videoLabel(value)
            if (courseKeyHints.has(key)) return courseLabel(value)
            return null
        }

        const humanise = (raw: unknown): unknown => {
            if (raw === null || raw === undefined) return raw
            if (Array.isArray(raw)) return raw.map(humanise)
            if (typeof raw === 'object') {
                const out: Record<string, unknown> = {}
                for (const [key, value] of Object.entries(
                    raw as Record<string, unknown>,
                )) {
                    if (typeof value === 'string' && UUID_RE.test(value)) {
                        out[key] = labelFor(key, value) ?? value
                    } else {
                        out[key] = humanise(value)
                    }
                }
                return out
            }
            return raw
        }

        const targetLabelOf = (event: {
            targetType: string
            targetId: string | null
        }): string | null => {
            if (!event.targetId) return null
            if (event.targetType === 'video') return videoLabel(event.targetId)
            if (event.targetType === 'playlist')
                return courseLabel(event.targetId)
            if (event.targetType === 'member') return userLabel(event.targetId)
            return null
        }

        return {
            data: data.map((event) => ({
                id: event.id,
                workspaceId: event.workspaceId,
                actorId: event.actorId,
                actorEmail: event.actorEmail,
                actorLabel: event.actorId
                    ? userLabel(event.actorId) ?? event.actorEmail
                    : event.actorEmail,
                action: event.action,
                targetType: event.targetType,
                targetId: event.targetId,
                targetLabel: targetLabelOf(event),
                metadata: humanise(event.metadata),
                createdAt: event.createdAt.toISOString(),
            })),
            total,
            curPage,
            perPage,
        }
    }
}
