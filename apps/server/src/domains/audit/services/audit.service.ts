import { Injectable, Logger } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'

export type AuditAction =
    | 'video.upload.create'
    | 'video.upload.complete'
    | 'video.update'
    | 'video.delete'
    | 'playlist.create'
    | 'playlist.update'
    | 'playlist.delete'
    | 'member.add'
    | 'member.remove'

export type AuditTargetType = 'video' | 'playlist' | 'member' | 'workspace'

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

        return {
            data: data.map((event) => ({
                id: event.id,
                workspaceId: event.workspaceId,
                actorId: event.actorId,
                actorEmail: event.actorEmail,
                action: event.action,
                targetType: event.targetType,
                targetId: event.targetId,
                metadata: event.metadata,
                createdAt: event.createdAt.toISOString(),
            })),
            total,
            curPage,
            perPage,
        }
    }
}
