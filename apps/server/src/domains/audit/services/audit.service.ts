import { Injectable, Logger } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'

// `<entity>.<camelCaseVerb>` so the audit page can split on the first dot.
// Legacy formats are rewritten by scripts/migrate-audit-action-names.sql.
export type AuditAction =
    | 'video.startUpload'
    | 'video.completeUpload'
    | 'video.update'
    | 'video.delete'
    | 'video.bulkUpdate'
    | 'playlist.create'
    | 'playlist.update'
    | 'playlist.delete'
    | 'member.add'
    | 'member.remove'
    | 'member.rejectPending'
    | 'member.updateAccess'
    | 'member.updateRole'
    | 'member.updateProfile'
    | 'member.updateOwnProfile'
    | 'member.updateNotes'
    | 'member.import'
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
    // These carry the affected club's workspaceId, so they land in that club's
    // journal too — an owner can see who created and handed over their club.
    | 'workspace.create'
    | 'workspace.update'
    | 'workspace.transferOwner'

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
        // Required key, nullable value: `null` means "every workspace". Required
        // rather than optional so forgetting it can't leak the whole platform.
        workspaceId: string | null
        curPage?: number
        perPage?: number
        actionPrefix?: string
        // Where a prefix is too coarse: the platform feed wants
        // workspace.create/update/transferOwner but not updateSettings.
        actions?: string[]
        // Coach-scoped readers pass `extraOr` to narrow to their own students,
        // groups and actions.
        extraOr?: Array<Record<string, unknown>>
    }) {
        const perPage = Math.min(payload.perPage ?? 50, 200)
        const curPage = Math.max(payload.curPage ?? 1, 1)
        const skip = (curPage - 1) * perPage

        const where: Record<string, unknown> = {}
        if (payload.workspaceId !== null) {
            where.workspaceId = payload.workspaceId
        }
        if (payload.actions) {
            where.action = { in: payload.actions }
        } else if (payload.actionPrefix) {
            where.action = { startsWith: payload.actionPrefix }
        }
        if (payload.extraOr) {
            where.OR = payload.extraOr
        }

        const [data, total] = await this.prisma.$transaction([
            this.prisma.auditEvent.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: perPage,
            }),
            this.prisma.auditEvent.count({ where }),
        ])

        // Bucket UUIDs by metadata key name (`userId` -> user), not by trying
        // every type — that produced ghost labels on cross-type id collisions.
        const userIds = new Set<string>()
        const videoIds = new Set<string>()
        const courseIds = new Set<string>()
        const gymIds = new Set<string>()
        const groupIds = new Set<string>()
        const slotIds = new Set<string>()
        const exceptionIds = new Set<string>()
        const eventIds = new Set<string>()

        const UUID_RE =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

        // Keys outside this list stay raw UUIDs — the safe default.
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
            'updatedVideo',
            'movedVideo',
            'addedVideo',
            'removedVideo',
        ])
        const chapterKeyHints = new Set([
            'chapterId',
            'targetChapterId',
            'movedChapter',
            'addedChapter',
            'removedChapter',
            'beforeChapterId',
            'afterChapterId',
        ])
        const chapterIds = new Set<string>()
        const courseKeyHints = new Set([
            'courseId',
            'playlistId',
            'targetCourseId',
        ])
        const gymKeyHints = new Set(['gymId', 'targetGymId'])
        const groupKeyHints = new Set(['groupId', 'targetGroupId'])
        const slotKeyHints = new Set(['slotId', 'targetSlotId'])
        const exceptionKeyHints = new Set(['exceptionId'])
        const eventKeyHints = new Set(['eventId', 'workspaceEventId'])
        const roleKeyHints = new Set([
            'roleId',
            'fromRoleId',
            'toRoleId',
            'targetRoleId',
        ])
        const roleIds = new Set<string>()

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
                        else if (gymKeyHints.has(key)) gymIds.add(value)
                        else if (groupKeyHints.has(key)) groupIds.add(value)
                        else if (slotKeyHints.has(key)) slotIds.add(value)
                        else if (exceptionKeyHints.has(key))
                            exceptionIds.add(value)
                        else if (eventKeyHints.has(key)) eventIds.add(value)
                        else if (roleKeyHints.has(key)) roleIds.add(value)
                        else if (chapterKeyHints.has(key))
                            chapterIds.add(value)
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

        const [
            users,
            videos,
            courses,
            gyms,
            groups,
            slots,
            exceptions,
            events,
            roles,
            chapters,
        ] = await Promise.all([
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
            gymIds.size > 0
                ? this.prisma.gym.findMany({
                      where: { id: { in: Array.from(gymIds) } },
                      select: { id: true, name: true },
                  })
                : [],
            groupIds.size > 0
                ? this.prisma.group.findMany({
                      where: { id: { in: Array.from(groupIds) } },
                      select: { id: true, name: true },
                  })
                : [],
            slotIds.size > 0
                ? this.prisma.groupScheduleSlot.findMany({
                      where: { id: { in: Array.from(slotIds) } },
                      select: {
                          id: true,
                          dayOfWeek: true,
                          startTime: true,
                          durationMin: true,
                      },
                  })
                : [],
            exceptionIds.size > 0
                ? this.prisma.scheduleException.findMany({
                      where: { id: { in: Array.from(exceptionIds) } },
                      select: {
                          id: true,
                          fromDate: true,
                          untilDate: true,
                          reason: true,
                      },
                  })
                : [],
            eventIds.size > 0
                ? this.prisma.workspaceEvent.findMany({
                      where: { id: { in: Array.from(eventIds) } },
                      select: { id: true, title: true },
                  })
                : [],
            roleIds.size > 0
                ? this.prisma.role.findMany({
                      where: { id: { in: Array.from(roleIds) } },
                      select: { id: true, name: true },
                  })
                : [],
            chapterIds.size > 0
                ? this.prisma.chapter.findMany({
                      where: { id: { in: Array.from(chapterIds) } },
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
        const gymLabel = (id: string): string | null =>
            gyms.find((x) => x.id === id)?.name ?? null
        const groupLabel = (id: string): string | null =>
            groups.find((x) => x.id === id)?.name ?? null
        const eventLabel = (id: string): string | null =>
            events.find((x) => x.id === id)?.title ?? null
        const roleLabel = (id: string): string | null =>
            roles.find((x) => x.id === id)?.name ?? null
        const chapterLabel = (id: string): string | null =>
            chapters.find((x) => x.id === id)?.title ?? null
        const DOW = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
        const slotLabel = (id: string): string | null => {
            const s = slots.find((x) => x.id === id)
            if (!s) return null
            return `${DOW[s.dayOfWeek] ?? s.dayOfWeek} ${s.startTime} (${s.durationMin} мин)`
        }
        const fmtDate = (d: Date): string => d.toISOString().slice(0, 10)
        const exceptionLabel = (id: string): string | null => {
            const e = exceptions.find((x) => x.id === id)
            if (!e) return null
            const range =
                fmtDate(e.fromDate) === fmtDate(e.untilDate)
                    ? fmtDate(e.fromDate)
                    : `${fmtDate(e.fromDate)} → ${fmtDate(e.untilDate)}`
            return e.reason ? `${range} (${e.reason})` : range
        }

        // Only relabel when the key tells us the type; a raw UUID beats
        // silently picking the wrong entity.
        const labelFor = (key: string, value: string): string | null => {
            if (userKeyHints.has(key)) return userLabel(value)
            if (videoKeyHints.has(key)) return videoLabel(value)
            if (courseKeyHints.has(key)) return courseLabel(value)
            if (gymKeyHints.has(key)) return gymLabel(value)
            if (groupKeyHints.has(key)) return groupLabel(value)
            if (slotKeyHints.has(key)) return slotLabel(value)
            if (exceptionKeyHints.has(key)) return exceptionLabel(value)
            if (eventKeyHints.has(key)) return eventLabel(value)
            if (roleKeyHints.has(key)) return roleLabel(value)
            if (chapterKeyHints.has(key)) return chapterLabel(value)
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
            if (event.targetType === 'gym') return gymLabel(event.targetId)
            if (event.targetType === 'group') return groupLabel(event.targetId)
            if (event.targetType === 'event') return eventLabel(event.targetId)
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
