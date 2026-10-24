import { Feature, IFeatureHandler } from '@shelfjs/features'

import {
    addDaysYmd,
    ymdToDbDate,
} from '../../domains/subscriptions/freeze-dates'
import { PrismaService } from '../../infrastructure/prisma'
import {
    localDateInTz,
    resolveSlotOccurrence,
} from '../attendance/attendance-utils'
import { loadDropInEligibility } from './drop-in-eligibility'
import { DROP_IN_BLOCK_MESSAGES } from './drop-in-utils'
import {
    GetMyDropInsFeature,
    GetMyDropInsFeatureResponse,
} from './get-my-drop-ins.feature'
import { serializeDropInBooking } from './schemas'

@Feature(GetMyDropInsFeature)
export class GetMyDropInsHandler
    implements IFeatureHandler<GetMyDropInsFeature, GetMyDropInsFeatureResponse>
{
    constructor(private readonly prisma: PrismaService) {}

    async execute({ workspaceId, invokerUserId }: GetMyDropInsFeature) {
        const now = new Date()
        const eligibility = await loadDropInEligibility(
            this.prisma,
            workspaceId,
            invokerUserId,
            now,
        )

        // One day of slack: a class in a zone ahead of the club's can still be
        // upcoming while the club calendar has moved on.
        const since = ymdToDbDate(
            addDaysYmd(localDateInTz(now, eligibility.timezone), -1),
        )
        const bookings = await this.prisma.dropInBooking.findMany({
            where: {
                workspaceId,
                userId: invokerUserId,
                sessionDate: { gte: since },
            },
            include: {
                slot: true,
                group: {
                    select: {
                        id: true,
                        name: true,
                        gym: {
                            select: {
                                id: true,
                                name: true,
                                address: true,
                                timezone: true,
                            },
                        },
                        coach: {
                            select: {
                                firstname: true,
                                lastname: true,
                                email: true,
                            },
                        },
                    },
                },
            },
        })

        const groupIds = [...new Set(bookings.map((b) => b.groupId))]
        const lastDate = new Date(
            Math.max(...bookings.map((b) => b.sessionDate.getTime())),
        )
        const exceptions = bookings.length
            ? await this.prisma.scheduleException.findMany({
                  where: {
                      groupId: { in: groupIds },
                      fromDate: { lte: lastDate },
                      untilDate: { gte: since },
                  },
                  select: {
                      groupId: true,
                      slotId: true,
                      fromDate: true,
                      untilDate: true,
                      reason: true,
                  },
              })
            : []

        const upcoming = bookings
            .map((b) => ({
                b,
                occ: resolveSlotOccurrence({
                    slot: b.slot,
                    sessionDate: b.sessionDate.toISOString().slice(0, 10),
                    gymTz: b.group.gym?.timezone ?? null,
                    workspaceTz: eligibility.timezone,
                    exceptions: exceptions.filter(
                        (e) => e.groupId === b.groupId,
                    ),
                }),
            }))
            .filter(({ occ }) => occ.endAt.getTime() > now.getTime())
            .sort((a, z) => a.occ.startAt.getTime() - z.occ.startAt.getTime())

        return {
            canBook: eligibility.reason === null,
            blockedReason: eligibility.reason
                ? DROP_IN_BLOCK_MESSAGES[eligibility.reason]
                : null,
            bookings: upcoming.map(({ b, occ }) =>
                serializeDropInBooking(b, occ),
            ),
        }
    }
}
