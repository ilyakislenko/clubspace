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
    | 'workspace.updateSettings'

export type AuditTargetType =
    | 'video'
    | 'playlist'
    | 'member'
    | 'workspace'
    | 'gym'
    | 'group'

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
    }) {
        const perPage = Math.min(payload.perPage ?? 50, 200)
        const curPage = Math.max(payload.curPage ?? 1, 1)
        const skip = (curPage - 1) * perPage

        const [data, total] = await this.prisma.$transaction([
            this.prisma.auditEvent.findMany({
                where: { workspaceId: payload.workspaceId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: perPage,
            }),
            this.prisma.auditEvent.count({
                where: { workspaceId: payload.workspaceId },
            }),
        ])

        // Collect every UUID that appears anywhere in the page so we can
        // resolve it to a human label in one round trip per entity type.
        const userIds = new Set<string>()
        const videoIds = new Set<string>()
        const courseIds = new Set<string>()

        const collectIds = (raw: unknown) => {
            if (raw === null || raw === undefined) return
            if (typeof raw === 'string') {
                if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
                    // We don't know the type yet — push to all three sets
                    // and the lookups below will only resolve real ones.
                    userIds.add(raw)
                    videoIds.add(raw)
                    courseIds.add(raw)
                }
                return
            }
            if (Array.isArray(raw)) {
                raw.forEach(collectIds)
                return
            }
            if (typeof raw === 'object') {
                Object.values(raw as Record<string, unknown>).forEach(collectIds)
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

        // Replace any UUID we recognise with a human label, recursively.
        const humanise = (raw: unknown): unknown => {
            if (raw === null || raw === undefined) return raw
            if (typeof raw === 'string') {
                return (
                    userLabel(raw) ??
                    videoLabel(raw) ??
                    courseLabel(raw) ??
                    raw
                )
            }
            if (Array.isArray(raw)) return raw.map(humanise)
            if (typeof raw === 'object') {
                const out: Record<string, unknown> = {}
                for (const [key, value] of Object.entries(
                    raw as Record<string, unknown>,
                )) {
                    out[key] = humanise(value)
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
