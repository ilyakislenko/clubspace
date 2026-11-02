import { Logger } from '@nestjs/common'
import { Feature, IFeatureHandler } from '@shelfjs/features'

import { AuditService } from '../../domains/audit/services/audit.service'
import { NotificationProducerService } from '../../domains/notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../../domains/realtime/realtime-emitter.service'
import { addDaysYmd } from '../../domains/subscriptions/freeze-dates'
import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import { loadClubVocabulary } from '../../shared/utils/club-vocabulary'
import {
    isSlotActiveOn,
    localDateInTz,
    resolveGroupSessionTz,
    scheduledOccurrenceKey,
} from '../attendance/attendance-utils'
import {
    coachCandidatesWhere,
    loadDecider,
    syncSessionCoach,
} from './class-substitution-access'
import {
    CreateClassSubstitutionFeature,
    CreateClassSubstitutionFeatureResponse,
} from './create-class-substitution.feature'
import { notifyClassSubstitution } from './notify-class-substitution'
import {
    classSubstitutionInclude,
    serializeClassSubstitution,
} from './schemas'

// A forgotten substitution can still be recorded for the past week's classes
// (so the substitute marks them); the schedule looks this far ahead.
const PAST_DAYS = 7
const AHEAD_DAYS = 90

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' && e !== null && 'code' in e && e.code === 'P2002'

@Feature(CreateClassSubstitutionFeature)
export class CreateClassSubstitutionHandler
    implements
        IFeatureHandler<
            CreateClassSubstitutionFeature,
            CreateClassSubstitutionFeatureResponse
        >
{
    private readonly logger = new Logger(CreateClassSubstitutionHandler.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly audit: AuditService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    async execute(f: CreateClassSubstitutionFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })
        const p = f.payload

        const slot = await this.prisma.groupScheduleSlot.findFirst({
            where: { id: p.slotId, group: { workspaceId: f.workspaceId } },
            include: {
                group: {
                    select: {
                        id: true,
                        directionId: true,
                        gym: { select: { timezone: true } },
                        workspace: { select: { timezone: true, ownerId: true } },
                        coaches: { select: { userId: true } },
                        direction: {
                            select: { managers: { select: { userId: true } } },
                        },
                    },
                },
            },
        })
        if (!slot) throw new NotFoundError({ message: 'Занятие не найдено' })
        const group = slot.group

        const date = new Date(`${p.sessionDate}T00:00:00Z`)
        const exceptions = await this.prisma.scheduleException.findMany({
            where: { groupId: group.id },
            select: { slotId: true, fromDate: true, untilDate: true },
        })
        if (!isSlotActiveOn(slot, slot.id, date, exceptions)) {
            throw new BadRequestError({
                message: 'В эту дату занятия нет (или оно отменено)',
            })
        }
        const tz = resolveGroupSessionTz(
            group.gym?.timezone ?? null,
            group.workspace.timezone,
        )
        const today = localDateInTz(new Date(), tz)
        if (p.sessionDate < addDaysYmd(today, -PAST_DAYS)) {
            throw new BadRequestError({
                message: 'Замену можно оформить только на занятие последней недели или будущее',
            })
        }
        if (p.sessionDate > addDaysYmd(today, AHEAD_DAYS)) {
            throw new BadRequestError({
                message: 'Слишком далёкая дата для замены',
            })
        }

        const decides = (await loadDecider(this.rbac, ctx))(group)
        const substituteId = p.substituteId ?? ctx.userId
        if (substituteId !== ctx.userId && !decides) {
            const v = await loadClubVocabulary(this.prisma, f.workspaceId)
            throw new ForbiddenError({
                message: `Назначить замену может ${v.coach.nom} группы, руководитель направления или администратор клуба`,
            })
        }
        if (group.coaches.some((c) => c.userId === substituteId)) {
            const v = await loadClubVocabulary(this.prisma, f.workspaceId)
            throw new BadRequestError({
                message:
                    substituteId === ctx.userId
                        ? 'Вы и так ведёте эту группу'
                        : `Этот ${v.coach.nom} и так ведёт эту группу`,
            })
        }
        const candidate = await this.prisma.user.findFirst({
            where: {
                id: substituteId,
                ...coachCandidatesWhere(f.workspaceId, group.workspace.ownerId),
            },
            select: { id: true },
        })
        if (!candidate) {
            const v = await loadClubVocabulary(this.prisma, f.workspaceId)
            throw new BadRequestError({
                message: `Заменять может только ${v.coach.nom} этого клуба`,
            })
        }

        const occurrenceKey = scheduledOccurrenceKey(slot.id, p.sessionDate)
        const now = new Date()
        const approved = decides
        const data = {
            substituteId,
            status: approved ? ('APPROVED' as const) : ('PENDING' as const),
            kind:
                substituteId === ctx.userId && !decides
                    ? ('OFFER' as const)
                    : ('ASSIGN' as const),
            requestedById: ctx.userId,
            decidedById: approved ? ctx.userId : null,
            decidedAt: approved ? now : null,
            note: p.note || null,
        }

        const existing = await this.prisma.classSubstitution.findUnique({
            where: {
                workspaceId_occurrenceKey: {
                    workspaceId: f.workspaceId,
                    occurrenceKey,
                },
            },
            select: { id: true },
        })
        if (existing && !decides) {
            throw new ConflictError({
                message: 'Для этого занятия уже есть замена или запрос на неё',
            })
        }

        let row
        try {
            // Whoever runs the group may replace a pending request or another
            // substitute with their choice.
            row = existing
                ? await this.prisma.classSubstitution.update({
                      where: { id: existing.id },
                      data,
                      include: classSubstitutionInclude,
                  })
                : await this.prisma.classSubstitution.create({
                      data: {
                          ...data,
                          workspaceId: f.workspaceId,
                          groupId: group.id,
                          slotId: slot.id,
                          sessionDate: date,
                          occurrenceKey,
                      },
                      include: classSubstitutionInclude,
                  })
        } catch (e) {
            if (!isP2002(e)) throw e
            throw new ConflictError({
                message: 'Для этого занятия уже есть замена или запрос на неё',
            })
        }

        if (approved) await syncSessionCoach(this.prisma, row, substituteId)

        await this.audit.record({
            action: approved ? 'group.substituteAssign' : 'group.substituteRequest',
            targetType: 'group',
            targetId: group.id,
            workspaceId: f.workspaceId,
            actorId: ctx.userId,
            metadata: {
                substitutionId: row.id,
                slotId: slot.id,
                sessionDate: p.sessionDate,
                substituteId,
            },
        })
        this.realtime.invalidate(f.workspaceId, ['schedule', 'substitutions'])
        await notifyClassSubstitution(
            {
                prisma: this.prisma,
                notifications: this.notifications,
                logger: this.logger,
            },
            row,
            approved ? 'approved' : 'requested',
            ctx.userId,
            [
                ...group.coaches.map((c) => c.userId),
                ...(group.direction?.managers ?? []).map((m) => m.userId),
            ],
        )

        return serializeClassSubstitution(row, {
            userId: ctx.userId,
            canDecide: decides,
        })
    }
}
