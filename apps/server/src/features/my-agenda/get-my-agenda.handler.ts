import { Feature, IFeatureHandler } from '@shelfjs/features'

import { directionRefSelect } from '../../domains/directions/direction-ref'
import { appFeatureSelect, toAppFeatureFlags } from '../../domains/workspace/feature-flags'
import { cap, vocabularyForWorkspaceType } from '../../shared/utils/club-vocabulary'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { addDays, daysBetween, parseDateOnly } from '../get-workspace-schedule/date-utils'
import { projectGroupOccurrences } from '../get-workspace-schedule/schedule-projection'
import {
    AgendaItem,
    GetMyAgendaFeature,
    GetMyAgendaFeatureResponse,
} from './get-my-agenda.feature'
import {
    isLiveMembership,
    localDateIn,
    MAX_AGENDA_DAYS,
    overlapsLocalWindow,
    personName,
} from './my-agenda-utils'

const PERSON_SELECT = {
    select: { firstname: true, lastname: true, email: true },
} as const

const GYM_SELECT = {
    select: { id: true, name: true, timezone: true },
} as const

// «Сегодня во всех клубах»: the caller's classes (groups they train in or
// coach), the clubs' events, their drop-in bookings and confirmed personal
// trainings, across every live club, each tagged with its club. Classes and
// drop-ins come from the same projection as the club schedule, so exceptions
// show as cancelled. Sections a club switched off are left out.
@Feature(GetMyAgendaFeature)
export class GetMyAgendaHandler
    implements IFeatureHandler<GetMyAgendaFeature, GetMyAgendaFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({
        payload,
        invokerUserId: userId,
    }: GetMyAgendaFeature): Promise<GetMyAgendaFeatureResponse> {
        const fromDate = parseDateOnly(payload.from)
        const toDate = parseDateOnly(payload.to)
        if (toDate < fromDate) {
            throw new BadRequestError({
                message: 'Дата «по» должна быть не раньше даты «с»',
            })
        }
        const dayCount = daysBetween(fromDate, toDate) + 1
        if (dayCount > MAX_AGENDA_DAYS) {
            throw new BadRequestError({
                message: `Слишком широкий период (максимум ${MAX_AGENDA_DAYS} дней)`,
            })
        }

        const now = new Date()
        const memberships = (
            await this.prisma.workspaceMember.findMany({
                where: { userId, status: 'ACTIVE', workspace: { isActive: true } },
                select: {
                    accessUntil: true,
                    workspace: {
                        select: {
                            id: true,
                            name: true,
                            timezone: true,
                            type: true,
                            ownerId: true,
                            ...appFeatureSelect,
                        },
                    },
                },
            })
        ).filter((m) => isLiveMembership(m, userId, now))
        if (memberships.length === 0) return { items: [] }

        const clubs = new Map(
            memberships.map((m) => [
                m.workspace.id,
                { ...m.workspace, features: toAppFeatureFlags(m.workspace, now) },
            ]),
        )
        const idsWith = (key: 'schedule' | 'events' | 'guestVisits') =>
            [...clubs.values()].filter((c) => c.features[key]).map((c) => c.id)
        const scheduleIds = idsWith('schedule')
        const eventIds = idsWith('events')
        const dropInIds = idsWith('guestVisits')

        // Instants of events/personal trainings are filtered by their local
        // day below; this wider UTC window just has to contain every zone.
        const wideFrom = addDays(fromDate, -1)
        const wideTo = addDays(toDate, 2)
        const exceptionWindow = {
            fromDate: { lte: toDate },
            untilDate: { gte: fromDate },
        }

        const [groups, bookings, events, trainings] = await Promise.all([
            scheduleIds.length
                ? this.prisma.group.findMany({
                      where: {
                          workspaceId: { in: scheduleIds },
                          OR: [
                              { coachId: userId },
                              { coaches: { some: { userId } } },
                              { members: { some: { userId } } },
                          ],
                      },
                      select: {
                          id: true,
                          name: true,
                          workspaceId: true,
                          coachId: true,
                          gym: GYM_SELECT,
                          direction: directionRefSelect,
                          slots: true,
                          exceptions: { where: exceptionWindow },
                          coaches: { where: { userId }, select: { userId: true } },
                      },
                  })
                : [],
            dropInIds.length
                ? this.prisma.dropInBooking.findMany({
                      where: {
                          userId,
                          workspaceId: { in: dropInIds },
                          sessionDate: { gte: fromDate, lte: toDate },
                      },
                      select: {
                          sessionDate: true,
                          workspaceId: true,
                          slot: true,
                          group: {
                              select: {
                                  id: true,
                                  name: true,
                                  gym: GYM_SELECT,
                                  direction: directionRefSelect,
                                  exceptions: { where: exceptionWindow },
                              },
                          },
                      },
                  })
                : [],
            eventIds.length
                ? this.prisma.workspaceEvent.findMany({
                      where: {
                          workspaceId: { in: eventIds },
                          startAt: { lt: wideTo },
                          endAt: { gte: wideFrom },
                      },
                      select: {
                          id: true,
                          workspaceId: true,
                          title: true,
                          startAt: true,
                          endAt: true,
                          timezone: true,
                          coachId: true,
                          gym: GYM_SELECT,
                          direction: directionRefSelect,
                      },
                  })
                : [],
            this.prisma.personalTrainingRequest.findMany({
                where: {
                    workspaceId: { in: [...clubs.keys()] },
                    status: 'CONFIRMED',
                    OR: [{ memberId: userId }, { coachId: userId }],
                    confirmedStartAt: { gte: wideFrom, lt: wideTo },
                },
                select: {
                    id: true,
                    workspaceId: true,
                    memberId: true,
                    timezone: true,
                    confirmedStartAt: true,
                    confirmedDurationMin: true,
                    member: PERSON_SELECT,
                    coach: PERSON_SELECT,
                },
            }),
        ])

        const items: AgendaItem[] = []
        const club = (workspaceId: string) => clubs.get(workspaceId)!
        const refs = {
            groupId: null,
            slotId: null,
            occurrenceId: null,
            eventId: null,
            personalTrainingId: null,
            direction: null,
        }

        // Groups are projected per club: an unanchored group's slots are in
        // its own club's zone.
        for (const c of clubs.values()) {
            const own = groups.filter((g) => g.workspaceId === c.id)
            for (const o of projectGroupOccurrences(own, fromDate, dayCount, c.timezone)) {
                const coaching =
                    o.group.coachId === userId || o.group.coaches.length > 0
                items.push({
                    ...refs,
                    id: `class:${o.slot.id}:${o.date}`,
                    kind: 'class',
                    workspaceId: c.id,
                    workspaceName: c.name,
                    title: o.group.name,
                    subtitle: o.group.gym?.name ?? null,
                    startAt: o.start.toISOString(),
                    endAt: o.end.toISOString(),
                    timezone: o.timezone,
                    date: o.date,
                    cancelled: o.cancelled,
                    cancellationReason: o.cancellationReason,
                    myRole: coaching ? 'coach' : 'member',
                    groupId: o.group.id,
                    slotId: o.slot.id,
                    occurrenceId: `${o.slot.id}:${o.date}`,
                    direction: o.group.direction,
                })
            }
        }

        for (const b of bookings) {
            const c = club(b.workspaceId)
            // One slot, one date: the booked occurrence itself.
            const [o] = projectGroupOccurrences(
                [{ ...b.group, slots: [b.slot] }],
                b.sessionDate,
                1,
                c.timezone,
            )
            // The slot no longer runs that day (retired or moved).
            if (!o) continue
            items.push({
                ...refs,
                id: `dropIn:${o.slot.id}:${o.date}`,
                kind: 'dropIn',
                workspaceId: c.id,
                workspaceName: c.name,
                title: o.group.name,
                subtitle: o.group.gym?.name ?? null,
                startAt: o.start.toISOString(),
                endAt: o.end.toISOString(),
                timezone: o.timezone,
                date: o.date,
                cancelled: o.cancelled,
                cancellationReason: o.cancellationReason,
                myRole: 'member',
                groupId: o.group.id,
                slotId: o.slot.id,
                occurrenceId: `${o.slot.id}:${o.date}`,
                direction: o.group.direction,
            })
        }

        for (const e of events) {
            const span = { start: e.startAt, end: e.endAt, timezone: e.timezone }
            if (!overlapsLocalWindow(span, payload.from, payload.to)) continue
            const c = club(e.workspaceId)
            items.push({
                ...refs,
                id: `event:${e.id}`,
                kind: 'event',
                workspaceId: c.id,
                workspaceName: c.name,
                title: e.title,
                subtitle: e.gym?.name ?? null,
                startAt: e.startAt.toISOString(),
                endAt: e.endAt.toISOString(),
                timezone: e.timezone,
                date: localDateIn(e.startAt, e.timezone),
                cancelled: false,
                cancellationReason: null,
                myRole: e.coachId === userId ? 'coach' : 'member',
                eventId: e.id,
                direction: e.direction,
            })
        }

        for (const t of trainings) {
            // CONFIRMED always carries a time; the filter is for the type.
            if (!t.confirmedStartAt) continue
            const start = t.confirmedStartAt
            const end = new Date(
                start.getTime() + (t.confirmedDurationMin ?? 60) * 60_000,
            )
            const span = { start, end, timezone: t.timezone }
            if (!overlapsLocalWindow(span, payload.from, payload.to)) continue
            const c = club(t.workspaceId)
            const asMember = t.memberId === userId
            items.push({
                ...refs,
                id: `personalTraining:${t.id}`,
                kind: 'personalTraining',
                workspaceId: c.id,
                workspaceName: c.name,
                title: cap(vocabularyForWorkspaceType(c.type).personalSession.nom),
                subtitle: personName(asMember ? t.coach : t.member),
                startAt: start.toISOString(),
                endAt: end.toISOString(),
                timezone: t.timezone,
                date: localDateIn(start, t.timezone),
                cancelled: false,
                cancellationReason: null,
                myRole: asMember ? 'member' : 'coach',
                personalTrainingId: t.id,
            })
        }

        items.sort((a, b) =>
            a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : a.id < b.id ? -1 : 1,
        )
        return { items }
    }
}
