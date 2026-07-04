import { Feature, IFeatureHandler } from '@shelfjs/features'

import { PrismaService } from '../../infrastructure/prisma'
import {
    BadRequestError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { CoachContext, RbacService } from '../../shared/services/rbac.service'
import {
    adhocOccurrenceKey,
    eventOccurrenceKey,
    isSlotActiveOn,
    localDateInTz,
    localMinuteInTz,
    resolveGroupSessionTz,
    scheduledOccurrenceKey,
    wallClockToUtc,
} from './attendance-utils'
import {
    CreateAttendanceSessionFeature,
    CreateAttendanceSessionFeatureResponse,
} from './create-session.feature'
import { serializeSession } from './schemas'

const isP2002 = (e: unknown): boolean =>
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === 'P2002'

const INCLUDE = { include: { _count: { select: { records: true } } } }

@Feature(CreateAttendanceSessionFeature)
export class CreateAttendanceSessionHandler
    implements
        IFeatureHandler<
            CreateAttendanceSessionFeature,
            CreateAttendanceSessionFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(f: CreateAttendanceSessionFeature) {
        const ctx = await this.rbac.resolveCoachScope({
            userId: f.invokerUserId,
            workspaceId: f.workspaceId,
            roleName: f.roleName,
            isSuperAdmin: f.isSuperAdmin,
        })

        const data = await this.buildData(ctx, f)
        try {
            const created = await this.prisma.attendanceSession.create({
                data,
                ...INCLUDE,
            })
            return serializeSession(created)
        } catch (e) {
            if (!isP2002(e)) throw e
            // Expected concurrent branch: another request created the same
            // occurrence first. Return the existing session, not a 500.
            const existing =
                await this.prisma.attendanceSession.findUniqueOrThrow({
                    where: {
                        workspaceId_occurrenceKey: {
                            workspaceId: f.workspaceId,
                            occurrenceKey: data.occurrenceKey,
                        },
                    },
                    ...INCLUDE,
                })
            return serializeSession(existing)
        }
    }

    private async buildData(
        ctx: CoachContext,
        f: CreateAttendanceSessionFeature,
    ) {
        const p = f.payload
        const base = {
            workspaceId: f.workspaceId,
            createdById: f.invokerUserId,
        }

        if (p.kind === 'scheduled') {
            if (!p.slotId || !p.sessionDate) {
                throw new BadRequestError({
                    message: 'scheduled requires slotId and sessionDate',
                })
            }
            const sessionDate = p.sessionDate
            const slot = await this.prisma.groupScheduleSlot.findFirst({
                where: { id: p.slotId, group: { workspaceId: f.workspaceId } },
                include: {
                    group: {
                        include: { gym: { select: { timezone: true } } },
                    },
                },
            })
            if (!slot) throw new NotFoundError({ message: 'Slot not found' })
            await this.rbac.assertCanWriteGroup(ctx, slot.groupId)

            const date = new Date(`${sessionDate}T00:00:00Z`)
            const exceptions = await this.prisma.scheduleException.findMany({
                where: { groupId: slot.groupId },
                select: { slotId: true, fromDate: true, untilDate: true },
            })
            if (!isSlotActiveOn(slot, slot.id, date, exceptions)) {
                throw new BadRequestError({
                    message:
                        'Slot is not scheduled (or is cancelled) on that date',
                })
            }
            const workspace = await this.prisma.workspace.findUnique({
                where: { id: f.workspaceId },
                select: { timezone: true },
            })
            const tz = resolveGroupSessionTz(
                slot.group.gym?.timezone ?? null,
                workspace!.timezone,
            )
            const startAt = wallClockToUtc(
                `${sessionDate}T${slot.startTime}`,
                tz,
            )
            return {
                ...base,
                groupId: slot.groupId,
                slotId: slot.id,
                sessionDate: date,
                occurrenceKey: scheduledOccurrenceKey(slot.id, sessionDate),
                title: slot.group.name,
                startAt,
                timezone: tz,
                coachId: slot.group.coachId,
            }
        }

        if (p.kind === 'adhoc') {
            if (!p.groupId || !p.startAt || !p.title) {
                throw new BadRequestError({
                    message: 'adhoc requires groupId, startAt and title',
                })
            }
            const { groupId, title } = p
            const wallClock = p.startAt
            const group = await this.prisma.group.findFirst({
                where: { id: groupId, workspaceId: f.workspaceId },
                include: { gym: { select: { timezone: true } } },
            })
            if (!group) throw new NotFoundError({ message: 'Group not found' })
            await this.rbac.assertCanWriteGroup(ctx, group.id)

            const workspace = await this.prisma.workspace.findUnique({
                where: { id: f.workspaceId },
                select: { timezone: true },
            })
            const tz = resolveGroupSessionTz(
                group.gym?.timezone ?? null,
                workspace!.timezone,
            )
            const startAt = wallClockToUtc(wallClock, tz)
            const localMinute = localMinuteInTz(startAt, tz)
            return {
                ...base,
                groupId: group.id,
                sessionDate: new Date(
                    `${localDateInTz(startAt, tz)}T00:00:00Z`,
                ),
                occurrenceKey: adhocOccurrenceKey(group.id, localMinute),
                title,
                startAt,
                timezone: tz,
                coachId: group.coachId,
            }
        }

        // event
        if (!p.workspaceEventId) {
            throw new BadRequestError({
                message: 'event requires workspaceEventId',
            })
        }
        if (!this.rbac.canWriteAllGroups(ctx)) {
            throw new BadRequestError({
                message: 'Only admin scope can take attendance for events',
            })
        }
        const event = await this.prisma.workspaceEvent.findFirst({
            where: { id: p.workspaceEventId, workspaceId: f.workspaceId },
            select: {
                id: true,
                title: true,
                startAt: true,
                timezone: true,
                coachId: true,
            },
        })
        if (!event) throw new NotFoundError({ message: 'Event not found' })
        return {
            ...base,
            workspaceEventId: event.id,
            occurrenceKey: eventOccurrenceKey(event.id),
            title: event.title,
            startAt: event.startAt,
            timezone: event.timezone,
            coachId: event.coachId,
        }
    }
}
