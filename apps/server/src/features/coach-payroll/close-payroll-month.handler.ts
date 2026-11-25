import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { computeLivePayroll } from '../../domains/payroll/payroll-loader'
import { lockPayroll } from '../../domains/payroll/payroll-lock'
import {
    computePayrollMonth,
    hasMonthEnded,
    lineDeltas,
    loadClosedPayrollMonth,
    writePayrollSnapshot,
} from '../../domains/payroll/payroll-month'
import { monthToDbDate } from '../../domains/payroll/payroll-rules'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { PrismaService } from '../../infrastructure/prisma'
import { assertClubAdmin } from '../../shared/access/assert-admin-scope'
import { DefaultError } from '../../shared/errors/default.error'
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { coachCandidatesWhere } from '../class-substitutions/class-substitution-access'
import {
    ClosePayrollMonthFeature,
    type ClosePayrollMonthFeatureResponse,
} from './close-payroll-month.feature'
import { loadActorName, parseMonthParam, serializePayrollMonth } from './schemas'

export const ALREADY_CLOSED_MESSAGE = 'Месяц уже закрыт'
export const TOTALS_CHANGED_MESSAGE = 'Суммы изменились — проверьте и закройте снова'

// «Закрыть месяц»: freezes the month the admin just checked. The totals are
// recomputed under the payroll lock and must equal what was confirmed.
@Feature(ClosePayrollMonthFeature)
export class ClosePayrollMonthHandler
    implements IFeatureHandler<ClosePayrollMonthFeature, ClosePayrollMonthFeatureResponse>
{
    private readonly logger = new Logger(ClosePayrollMonthHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: ClosePayrollMonthFeature): Promise<ClosePayrollMonthFeatureResponse> {
        const month = parseMonthParam(f.month)
        const ctx = await assertClubAdmin(this.rbac, {
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { timezone: true, coachPayVisible: true },
        })
        if (!workspace) throw new NotFoundError({ message: 'Клуб не найден' })
        const now = new Date()
        if (!hasMonthEnded(month, workspace.timezone, now)) {
            throw new BadRequestError({ message: 'Месяц ещё не закончился' })
        }
        const closedBy = {
            id: f.invokerUserId,
            name: await loadActorName(this.prisma, f.invokerUserId),
        }

        let snapshot
        try {
            snapshot = await this.prisma.$transaction(
                async (tx) => {
                    await lockPayroll(tx, f.workspaceId)
                    if (await loadClosedPayrollMonth(tx, f.workspaceId, month)) {
                        throw new ConflictError({ message: ALREADY_CLOSED_MESSAGE })
                    }
                    const live = await computeLivePayroll(tx, { workspaceId: f.workspaceId, month })
                    const { expectedTotal, expectedLines } = f.payload
                    if (
                        live.total !== expectedTotal ||
                        (expectedLines !== undefined &&
                            lineDeltas(expectedLines, live.lines).length > 0)
                    ) {
                        throw new DefaultError({
                            message: TOTALS_CHANGED_MESSAGE,
                            code: 'STALE_UPDATE',
                            statusCode: 409,
                        })
                    }
                    return writePayrollSnapshot(tx, {
                        workspaceId: f.workspaceId,
                        live,
                        closedBy,
                        closedAt: now,
                    })
                },
                // The whole month is recomputed inside.
                { timeout: 30_000 },
            )
        } catch (e) {
            if ((e as { code?: string } | null)?.code === 'P2002') {
                throw new ConflictError({ message: ALREADY_CLOSED_MESSAGE })
            }
            throw e
        }

        await this.audit.record({
            action: 'payroll.closeMonth',
            targetType: 'payroll',
            targetId: snapshot.id,
            workspaceId: f.workspaceId,
            actorId: f.invokerUserId,
            metadata: {
                month,
                total: snapshot.total,
                currency: snapshot.currency,
                coaches: snapshot.lines.length,
            },
        })
        this.realtime.invalidate(f.workspaceId, ['payroll'])
        if (workspace.coachPayVisible) {
            // Only people who can still open «Мои выплаты» (a coach who left
            // or became a student would land on a refusal).
            const recipients = await this.prisma.user.findMany({
                where: {
                    id: { in: snapshot.lines.map((l) => l.coachId).filter((id) => id !== f.invokerUserId) },
                    ...coachCandidatesWhere(f.workspaceId, ctx.workspaceOwnerId),
                },
                select: { id: true },
            })
            await this.notifyCoaches(
                f.workspaceId,
                month,
                recipients.map((r) => r.id),
                snapshot.closedAt,
            )
        }

        return serializePayrollMonth(
            await computePayrollMonth(this.prisma, { workspaceId: f.workspaceId, month, now }),
        )
    }

    // «Выплаты за ноябрь готовы» — never the amount (a push shows on the lock
    // screen). Best-effort: a failed push never fails the close.
    private async notifyCoaches(
        workspaceId: string,
        month: string,
        coachIds: string[],
        closedAt: Date,
    ): Promise<void> {
        const monthName = new Intl.DateTimeFormat('ru-RU', {
            month: 'long',
            timeZone: 'UTC',
        }).format(monthToDbDate(month))
        for (const userId of coachIds) {
            try {
                await this.notifications.notifyUser({
                    userId,
                    kind: 'payroll.closed',
                    refId: `${workspaceId}:${month}:${closedAt.getTime()}:${userId}`,
                    topic: `Выплаты за ${monthName} готовы`,
                    message: 'Посмотрите в профиле: «Мои выплаты».',
                    metadata: { workspaceId, month },
                    workspaceId,
                })
            } catch (err) {
                this.logger.warn(
                    `Payroll notification failed: ${err instanceof Error ? err.message : String(err)}`,
                )
            }
        }
    }
}
