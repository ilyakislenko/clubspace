import { Feature, IFeatureHandler } from '@shelfjs/features'

import { directionRefSelect } from '../../domains/directions/direction-ref'
import { EventRegistrationService } from '../../domains/event-registrations/event-registration.service'
import { PrismaService } from '../../infrastructure/prisma'
import { BadRequestError } from '../../shared/errors/shared.errors'
import { clubTakesOnlinePayments } from '../online-payments/load-buyer'
import {
    EVENTS_MAX_RANGE_DAYS,
    ListWorkspaceEventsFeature,
    ListWorkspaceEventsFeatureResponse,
} from './list-workspace-events.feature'
import { serializeEvent } from './schemas'

const DEFAULT_RANGE_DAYS = 60

@Feature(ListWorkspaceEventsFeature)
export class ListWorkspaceEventsHandler
    implements
        IFeatureHandler<
            ListWorkspaceEventsFeature,
            ListWorkspaceEventsFeatureResponse
        >
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly registrations: EventRegistrationService,
    ) {}

    async execute({
        payload,
        workspaceId,
        invokerUserId,
    }: ListWorkspaceEventsFeature) {
        // Defaults: today (UTC midnight) → +60d. Any window is at most
        // EVENTS_MAX_RANGE_DAYS long, so one call never reads a club's whole
        // history.
        const now = new Date()
        const fromDate = payload.from
            ? new Date(payload.from)
            : new Date(
                  Date.UTC(
                      now.getUTCFullYear(),
                      now.getUTCMonth(),
                      now.getUTCDate(),
                  ),
              )
        const toDate = payload.to
            ? new Date(payload.to)
            : new Date(fromDate.getTime() + DEFAULT_RANGE_DAYS * 86400_000)
        if (toDate < fromDate) {
            throw new BadRequestError({ message: 'Конец периода раньше начала' })
        }
        if (toDate.getTime() - fromDate.getTime() > EVENTS_MAX_RANGE_DAYS * 86400_000) {
            throw new BadRequestError({
                message: `Период не длиннее ${EVENTS_MAX_RANGE_DAYS} дней`,
            })
        }

        const rows = await this.prisma.workspaceEvent.findMany({
            where: {
                workspaceId,
                // Overlap test: include events that touch the window at all.
                startAt: { lte: toDate },
                endAt: { gte: fromDate },
                ...(payload.directionId
                    ? { directionId: payload.directionId }
                    : {}),
            },
            orderBy: { startAt: 'asc' },
            include: {
                gym: { select: { id: true, name: true, address: true } },
                direction: directionRefSelect,
                coach: {
                    select: {
                        id: true,
                        email: true,
                        firstname: true,
                        lastname: true,
                    },
                },
            },
        })

        // Only read when there is a ticket to pay for.
        const onlinePayments =
            rows.some((e) => (e.price ?? 0) > 0) &&
            (await clubTakesOnlinePayments(this.prisma, workspaceId))
        const places = await this.registrations.summaries(
            rows,
            invokerUserId,
            onlinePayments,
        )
        return {
            data: rows.map((e) => ({
                ...serializeEvent(e),
                registration: places.get(e.id) ?? null,
            })),
        }
    }
}
