import { Feature, IFeatureHandler } from '@shelfjs/features'

import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { syncFirstVisitStartInTx } from '../../domains/subscriptions/first-visit-start'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { cap, loadClubVocabulary } from '../../shared/utils/club-vocabulary'
import { localDateInTz } from './attendance-utils'
import {
    ChangeRecordAbonementFeature,
    ChangeRecordAbonementFeatureResponse,
} from './change-record-abonement.feature'
import { CheckInFollowUpService } from './check-in-follow-up.service'
import { buildRoster } from './roster'
import { loadSessionForWrite } from './session-access'
import {
    chargeVisits,
    loadSessionVisitOptions,
    refundConsumedClass,
    sessionUsesAbonements,
    visitAbonementRefusedMessage,
} from './session-visits'

// The coach picks another abonement for a visit already marked («списать с
// другого абонемента»): the class the visit took (if any) goes back to its
// pack, the new abonement pays (a pack is decremented, a time-based one only
// counts it), and the «с первой тренировки» starts of the member re-derive.
@Feature(ChangeRecordAbonementFeature)
export class ChangeRecordAbonementHandler
    implements
        IFeatureHandler<
            ChangeRecordAbonementFeature,
            ChangeRecordAbonementFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly realtime: RealtimeEmitter,
        private readonly followUps: CheckInFollowUpService,
    ) {}

    async execute(f: ChangeRecordAbonementFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const session = await loadSessionForWrite(
            this.prisma,
            this.rbac,
            ctx,
            f.workspaceId,
            f.sessionId,
        )
        // Paid off-app: a personal session never draws an abonement; a paid
        // event is paid for by its ticket.
        if (!(await sessionUsesAbonements(this.prisma, session))) {
            const v = await loadClubVocabulary(this.prisma, f.workspaceId)
            throw new BadRequestError({
                message: session.isPersonal
                    ? `${cap(v.personalSession.nom)} не списывается с абонемента`
                    : 'Платное событие оплачивается отдельно — абонемент не списывается',
            })
        }
        const workspace = await this.prisma.workspace.findUnique({
            where: { id: f.workspaceId },
            select: { timezone: true },
        })
        const now = new Date()

        const charge = await this.prisma.$transaction(async (tx) => {
            const record = await tx.attendanceRecord.findUnique({
                where: {
                    sessionId_userId: {
                        sessionId: session.id,
                        userId: f.userId,
                    },
                },
                select: {
                    usedSubscriptionId: true,
                    consumedSubscriptionId: true,
                },
            })
            if (!record) {
                throw new NotFoundError({ message: 'Отметка не найдена' })
            }
            // Already spent on it: nothing to move.
            if (record.usedSubscriptionId === f.payload.subscriptionId) {
                return null
            }

            const visits = await loadSessionVisitOptions(tx, {
                workspaceId: f.workspaceId,
                sessionId: session.id,
                dayYmd: localDateInTz(
                    session.startAt,
                    workspace?.timezone ?? 'UTC',
                ),
                userIds: [f.userId],
                now,
            })
            const chosen = visits.ranked
                .get(f.userId)
                ?.find((c) => c.id === f.payload.subscriptionId)
            if (!chosen) {
                throw new BadRequestError({
                    message: visitAbonementRefusedMessage(
                        await loadClubVocabulary(this.prisma, f.workspaceId),
                    ),
                })
            }

            if (record.consumedSubscriptionId) {
                await refundConsumedClass(tx, record.consumedSubscriptionId)
            }
            const [spent] = await chargeVisits(tx, session.id, [
                { userId: f.userId, options: [chosen] },
            ])
            // The pack's last class went to another check-in meantime: undo
            // the refund with the rest of the transaction.
            if (!spent) {
                throw new BadRequestError({
                    message: visitAbonementRefusedMessage(
                        await loadClubVocabulary(this.prisma, f.workspaceId),
                    ),
                })
            }
            // Both the old and the new abonement may start on a first visit.
            await syncFirstVisitStartInTx(tx, {
                workspaceId: f.workspaceId,
                userId: f.userId,
                now,
            })
            return spent
        })

        if (charge) {
            this.realtime.invalidateCoalesced(f.workspaceId, ['attendance'])
            this.realtime.invalidateUsersInWorkspace([f.userId], f.workspaceId, [
                'attendance',
                'subscription',
            ])
            // Low / used-up pack alert for the newly drawn pack.
            if (charge.consumedId) {
                this.followUps.schedule({
                    workspaceId: f.workspaceId,
                    userIds: [],
                    subscriptionIds: [charge.consumedId],
                })
            }
        }

        return buildRoster(this.prisma, session, {
            userId: ctx.userId,
            seesAllGroups: this.rbac.canSeeAllGroups(ctx),
        })
    }
}
