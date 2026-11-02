// Registration for events with a price or a limit of places (a guest teacher's
// master class): a place or a waitlist place, cancelling, automatic promotion
// with an «Освободилось место» push. Mirrors «Запись на занятие»
// (domains/class-bookings): every write to one event's registrations first
// takes the WorkspaceEvent row lock (SELECT … FOR UPDATE) inside its
// transaction, so the count of places, "one live registration per member" and
// promotion are serialized per event across API replicas. Pushes are deduped
// on (kind, registrationId).
//
// No abonement is checked or spent: a paid event is paid for by its ticket,
// which staff mark paid at the club (features/event-registrations); marking
// the visit skips abonements (features/attendance/session-visits.ts).
import { Injectable, Logger } from '@nestjs/common'

import { formatLocalDateTimeRu } from '../../features/attendance/attendance-utils'
import {
    byQueueOrder,
    serializeRegistration,
    waitlistPositions,
    type EventRegistrationOutput,
    type EventRegistrationStatusValue,
    type EventRegistrationSummary,
} from '../../features/event-registrations/schemas'
import {
    PrismaService,
    type PrismaTransactionClientType,
} from '../../infrastructure/prisma'
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
} from '../../shared/errors/shared.errors'
import { loadClubVocabulary } from '../../shared/utils/club-vocabulary'
import { NotificationProducerService } from '../notifications/services/notification-producer.service'
import { RealtimeEmitter } from '../realtime/realtime-emitter.service'

type Tx = PrismaTransactionClientType

export const LIVE_REGISTRATION_STATUSES: EventRegistrationStatusValue[] = [
    'BOOKED',
    'WAITLISTED',
]
const LIVE = LIVE_REGISTRATION_STATUSES

// Members register only for an event with a price or a limit of places; a
// free event without a limit works as before (just come).
export const registrationOpen = (e: {
    price: number | null
    capacity: number | null
}): boolean => e.price !== null || e.capacity !== null

const eventSelect = {
    id: true,
    workspaceId: true,
    title: true,
    startAt: true,
    timezone: true,
    price: true,
    capacity: true,
} as const

type LoadedEvent = {
    id: string
    workspaceId: string
    title: string
    startAt: Date
    timezone: string
    price: number | null
    capacity: number | null
}

type Promoted = { id: string; userId: string }

@Injectable()
export class EventRegistrationService {
    private readonly logger = new Logger(EventRegistrationService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationProducerService,
        private readonly realtime: RealtimeEmitter,
    ) {}

    private async loadEvent(
        workspaceId: string,
        eventId: string,
    ): Promise<LoadedEvent> {
        const event = await this.prisma.workspaceEvent.findFirst({
            where: { id: eventId, workspaceId },
            select: eventSelect,
        })
        if (!event) throw new NotFoundError({ message: 'Событие не найдено' })
        return event
    }

    // Takes the event's row lock for the rest of the transaction and returns
    // what the rules need as it is now (the capacity may have changed).
    private async lock(
        tx: Tx,
        eventId: string,
    ): Promise<{ capacity: number | null; startAt: Date }> {
        const [row] = await tx.$queryRaw<
            Array<{ capacity: number | null; startAt: Date }>
        >`SELECT "capacity", "startAt" FROM "WorkspaceEvent" WHERE "id" = ${eventId}::uuid FOR UPDATE`
        if (!row) throw new NotFoundError({ message: 'Событие не найдено' })
        return row
    }

    // The member-facing view of one registration.
    async view(r: {
        id: string
        eventId: string
        status: EventRegistrationStatusValue
        isPaid: boolean
        promotedAt: Date | null
        cancelledAt: Date | null
        createdAt: Date
    }): Promise<EventRegistrationOutput> {
        if (r.status !== 'WAITLISTED') return serializeRegistration(r, null)
        const queue = await this.prisma.eventRegistration.findMany({
            where: { eventId: r.eventId, status: 'WAITLISTED' },
            select: { id: true, status: true, createdAt: true },
        })
        return serializeRegistration(r, waitlistPositions(queue).get(r.id) ?? null)
    }

    private async assertActiveMember(workspaceId: string, userId: string) {
        // The owner has no member row: refused like any non-member.
        const member = await this.prisma.workspaceMember.findUnique({
            where: { userId_workspaceId: { userId, workspaceId } },
            select: { status: true },
        })
        if (!member) {
            throw new ForbiddenError({
                message: 'Запись на события доступна участникам клуба',
            })
        }
        if (member.status !== 'ACTIVE') {
            throw new ForbiddenError({
                message: `Ваше участие в клубе приостановлено — обратитесь к ${(await loadClubVocabulary(this.prisma, workspaceId)).coach.dat}`,
            })
        }
    }

    // ---- member actions ----------------------------------------------------

    // Registers `userId` for a place (a waitlist place when the event is
    // full). Re-sending returns the registration the member already holds.
    async register(p: {
        workspaceId: string
        eventId: string
        userId: string
        actorId: string
        now?: Date
    }): Promise<EventRegistrationOutput> {
        const now = p.now ?? new Date()
        const event = await this.loadEvent(p.workspaceId, p.eventId)
        if (!registrationOpen(event)) {
            throw new BadRequestError({
                message: 'На это событие запись не нужна — просто приходите',
            })
        }
        if (event.startAt.getTime() <= now.getTime()) {
            throw new BadRequestError({
                message: 'Запись закрыта — событие уже началось',
            })
        }
        await this.assertActiveMember(p.workspaceId, p.userId)

        const { registration, promoted } = await this.prisma.$transaction(
            async (tx) => {
                const row = await this.lock(tx, event.id)
                const live = await tx.eventRegistration.findMany({
                    where: { eventId: event.id, status: { in: LIVE } },
                })
                const mine = live.find((r) => r.userId === p.userId)
                if (mine) return { registration: mine, promoted: [] as Promoted[] }
                // A place freed outside a registration transaction (a member
                // who left the club) goes to the waitlist before a newcomer.
                const promoted = live.some((r) => r.status === 'WAITLISTED')
                    ? await this.promoteInTx(tx, event.id, row, now)
                    : []
                const booked =
                    live.filter((r) => r.status === 'BOOKED').length +
                    promoted.length
                const registration = await tx.eventRegistration.create({
                    data: {
                        workspaceId: p.workspaceId,
                        eventId: event.id,
                        userId: p.userId,
                        status:
                            row.capacity === null || booked < row.capacity
                                ? 'BOOKED'
                                : 'WAITLISTED',
                        bookedById: p.actorId,
                    },
                })
                return { registration, promoted }
            },
        )
        this.invalidate(p.workspaceId)
        await this.notifyPromoted(event, promoted)
        return this.view(registration)
    }

    // The member gives up their place (or waitlist place); a freed place goes
    // to the waitlist at once. A paid ticket stays marked paid on the
    // cancelled row — refunding it is the club's call (staff unmark it).
    async cancelOwn(p: {
        workspaceId: string
        userId: string
        registrationId: string
        now?: Date
    }): Promise<EventRegistrationOutput> {
        const now = p.now ?? new Date()
        const registration = await this.prisma.eventRegistration.findFirst({
            where: {
                id: p.registrationId,
                workspaceId: p.workspaceId,
                userId: p.userId,
            },
        })
        if (!registration) {
            throw new NotFoundError({ message: 'Запись не найдена' })
        }
        if (!LIVE.includes(registration.status)) return this.view(registration)
        const event = await this.loadEvent(p.workspaceId, registration.eventId)
        if (event.startAt.getTime() <= now.getTime()) {
            throw new BadRequestError({
                message: 'Событие уже началось — отменить запись нельзя',
            })
        }
        const { updated, promoted } = await this.prisma.$transaction(
            async (tx) => {
                const row = await this.lock(tx, event.id)
                const current = await tx.eventRegistration.findUniqueOrThrow({
                    where: { id: registration.id },
                })
                if (!LIVE.includes(current.status)) {
                    return { updated: current, promoted: [] as Promoted[] }
                }
                const updated = await tx.eventRegistration.update({
                    where: { id: registration.id },
                    data: { status: 'CANCELLED', cancelledAt: now },
                })
                const promoted =
                    current.status === 'BOOKED'
                        ? await this.promoteInTx(tx, event.id, row, now)
                        : []
                return { updated, promoted }
            },
        )
        this.invalidate(p.workspaceId)
        await this.notifyPromoted(event, promoted)
        return this.view(updated)
    }

    // ---- promotion ---------------------------------------------------------

    // Moves waitlisted registrations into free places, oldest first. Caller
    // holds the event lock. Promotions close when the event starts.
    private async promoteInTx(
        tx: Tx,
        eventId: string,
        row: { capacity: number | null; startAt: Date },
        now: Date,
    ): Promise<Promoted[]> {
        if (row.startAt.getTime() <= now.getTime()) return []
        const live = await tx.eventRegistration.findMany({
            where: { eventId, status: { in: LIVE } },
            select: { id: true, userId: true, status: true, createdAt: true },
        })
        live.sort(byQueueOrder)
        let free =
            row.capacity === null
                ? Number.POSITIVE_INFINITY
                : row.capacity - live.filter((r) => r.status === 'BOOKED').length
        const promoted: Promoted[] = []
        for (const r of live) {
            if (free <= 0) break
            if (r.status !== 'WAITLISTED') continue
            const moved = await tx.eventRegistration.updateMany({
                where: { id: r.id, status: 'WAITLISTED' },
                data: { status: 'BOOKED', promotedAt: now },
            })
            if (moved.count === 1) {
                promoted.push({ id: r.id, userId: r.userId })
                free -= 1
            }
        }
        return promoted
    }

    // Hands free places to the waitlist — after the event's limit was raised
    // or removed. Returns how many moved.
    async promote(
        workspaceId: string,
        eventId: string,
        now: Date = new Date(),
    ): Promise<number> {
        const event = await this.loadEvent(workspaceId, eventId)
        const promoted = await this.prisma.$transaction(async (tx) => {
            const row = await this.lock(tx, eventId)
            return this.promoteInTx(tx, eventId, row, now)
        })
        if (promoted.length > 0) {
            this.invalidate(workspaceId)
            await this.notifyPromoted(event, promoted)
        }
        return promoted.length
    }

    // Best-effort push, deduped on (kind, registrationId): the write is
    // committed, a failed push must not undo it.
    private async notifyPromoted(event: LoadedEvent, promoted: Promoted[]) {
        const when = formatLocalDateTimeRu(event.startAt, event.timezone)
        for (const r of promoted) {
            try {
                await this.notifications.notifyUser({
                    userId: r.userId,
                    kind: 'eventregistration.promoted',
                    refId: r.id,
                    topic: 'Освободилось место',
                    message: `Вы записаны на «${event.title}» ${when}. Не сможете прийти — отмените запись в приложении`,
                    metadata: { registrationId: r.id, eventId: event.id },
                    workspaceId: event.workspaceId,
                })
            } catch (err) {
                this.logger.warn(
                    `Event registration push failed: ${
                        err instanceof Error ? err.message : String(err)
                    }`,
                )
            }
        }
    }

    // ---- reads -------------------------------------------------------------

    // Places taken / queued per event and the viewer's own live registration,
    // for the events of `events` members register for. One query.
    async summaries(
        events: ReadonlyArray<{
            id: string
            price: number | null
            capacity: number | null
        }>,
        viewerId: string,
    ): Promise<Map<string, EventRegistrationSummary>> {
        const ids = events.filter(registrationOpen).map((e) => e.id)
        const out = new Map<string, EventRegistrationSummary>()
        if (ids.length === 0) return out
        const rows = await this.prisma.eventRegistration.findMany({
            where: { eventId: { in: ids }, status: { in: LIVE } },
            select: {
                id: true,
                eventId: true,
                userId: true,
                status: true,
                isPaid: true,
                promotedAt: true,
                cancelledAt: true,
                createdAt: true,
            },
        })
        for (const id of ids) {
            const ofEvent = rows.filter((r) => r.eventId === id)
            const positions = waitlistPositions(ofEvent)
            const own = ofEvent.find((r) => r.userId === viewerId)
            out.set(id, {
                booked: ofEvent.filter((r) => r.status === 'BOOKED').length,
                waitlist: positions.size,
                mine: own
                    ? serializeRegistration(own, positions.get(own.id) ?? null)
                    : null,
            })
        }
        return out
    }

    // Event screens refetch the places; staff lists the registrations.
    invalidate(workspaceId: string) {
        this.realtime.invalidate(workspaceId, ['events', 'eventregistrations'])
    }
}
