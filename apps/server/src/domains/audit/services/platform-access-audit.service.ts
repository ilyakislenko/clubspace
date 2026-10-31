import { Injectable, Logger } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/prisma'
import { AuditService } from './audit.service'

// One journal entry per admin, club and window: a platform admin browsing a
// club fires dozens of requests a minute, and the owner needs "who looked and
// when", not every request.
export const PLATFORM_ACCESS_WINDOW_MS = 60 * 60 * 1000

// Bound on remembered (admin, club) pairs; expired ones are dropped first.
const MAX_TRACKED = 10_000

/**
 * Writes `platform.accessClub` into a club's journal when a platform admin
 * reaches it without being its owner or member — the only way into a club
 * that no club role explains. Deduplicated in memory per process, so several
 * API instances may each write one entry per window.
 */
@Injectable()
export class PlatformAccessAuditService {
    private readonly logger = new Logger(PlatformAccessAuditService.name)
    private readonly seenUntil = new Map<string, number>()

    constructor(
        private readonly prisma: PrismaService,
        private readonly audit: AuditService,
    ) {}

    async noteAccess(payload: {
        userId: string
        workspaceId: string
        method: string
        // The route pattern (`/workspaces/:workspaceId/members`), never the
        // raw URL: no ids or query strings land in the journal.
        route: string | undefined
    }): Promise<void> {
        const key = `${payload.userId}:${payload.workspaceId}`
        const now = Date.now()
        const until = this.seenUntil.get(key)
        if (until !== undefined && until > now) return
        this.remember(key, now)

        try {
            const [workspace, membership] = await Promise.all([
                this.prisma.workspace.findUnique({
                    where: { id: payload.workspaceId },
                    select: { ownerId: true },
                }),
                this.prisma.workspaceMember.findUnique({
                    where: {
                        userId_workspaceId: {
                            userId: payload.userId,
                            workspaceId: payload.workspaceId,
                        },
                    },
                    select: { id: true },
                }),
            ])
            // No such club: nothing to write the entry against. Owner or
            // member: their club role already explains the access.
            if (
                !workspace ||
                workspace.ownerId === payload.userId ||
                membership
            ) {
                return
            }
            await this.audit.record({
                action: 'platform.accessClub',
                targetType: 'workspace',
                targetId: payload.workspaceId,
                workspaceId: payload.workspaceId,
                actorId: payload.userId,
                metadata: {
                    method: payload.method,
                    ...(payload.route ? { route: payload.route } : {}),
                },
            })
        } catch (error) {
            // Called fire-and-forget from a guard: never surface a failure.
            this.logger.error(
                'Failed to audit platform access to a club',
                error instanceof Error ? error.stack : String(error),
            )
        }
    }

    private remember(key: string, now: number) {
        if (this.seenUntil.size >= MAX_TRACKED) {
            for (const [k, until] of this.seenUntil) {
                if (until <= now) this.seenUntil.delete(k)
            }
            // Still full of live entries: forget the oldest one.
            if (this.seenUntil.size >= MAX_TRACKED) {
                const oldest = this.seenUntil.keys().next().value
                if (oldest !== undefined) this.seenUntil.delete(oldest)
            }
        }
        // Re-insert so Map order stays oldest-first for the eviction above.
        this.seenUntil.delete(key)
        this.seenUntil.set(key, now + PLATFORM_ACCESS_WINDOW_MS)
    }
}
