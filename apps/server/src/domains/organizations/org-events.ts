// Federation events (design docs/design/2026-11-26-federation-hub-mvp.md §2,
// §3.3): their own model, free registration with an optional capacity and no
// waitlist, the fee only as text. A person registers through a club that is
// ACTIVE in the org with `allowMemberEvents`, and only with their
// ORGANIZATION_SHARING consent — the org then sees their name and club.
// Every write to one event's registrations takes the event's row lock
// (SELECT … FOR UPDATE), as «Запись на событие» does, so the last place goes
// to exactly one person across API replicas.
import type {
    PrismaService,
    PrismaTransactionClientType,
} from '../../infrastructure/prisma'
import { DefaultError } from '../../shared/errors/default.error'
import { BadRequestError, NotFoundError } from '../../shared/errors/shared.errors'
import { fullNameWithoutEmail } from '../../shared/utils/person-name'
import {
    consentedPersonIds,
    hasOrgConsent,
    OrgConsentRequiredError,
} from './consent'
import { type RegistryBelt, registryBeltsFor } from './registry'
import { releaseRegistrationEntryIn } from '../tournaments/tournament-store'

type Tx = PrismaTransactionClientType

export type OrgEventForRegistration = {
    id: string
    organizationId: string
    title: string
    startAt: Date
    timezone: string
    audience: 'STAFF' | 'STAFF_AND_MEMBERS'
    publishedAt: Date | null
    registrationOpen: boolean
    registrationClosesAt: Date | null
}

// Why registration is closed, or null when it is open (capacity aside).
export const registrationClosedReason = (
    e: Pick<
        OrgEventForRegistration,
        'publishedAt' | 'registrationOpen' | 'registrationClosesAt' | 'startAt'
    >,
    now: Date,
): string | null => {
    if (!e.publishedAt || e.publishedAt > now) return 'Событие ещё не опубликовано'
    if (!e.registrationOpen) return 'Запись на событие закрыта'
    if (e.registrationClosesAt && e.registrationClosesAt <= now) {
        return 'Запись на событие закрыта'
    }
    if (e.startAt <= now) return 'Запись закрыта — событие уже началось'
    return null
}

const lockEvent = async (
    tx: Tx,
    eventId: string,
): Promise<{ capacity: number | null }> => {
    const [row] = await tx.$queryRaw<Array<{ capacity: number | null }>>`
        SELECT "capacity" FROM "OrganizationEvent" WHERE "id" = ${eventId}::uuid FOR UPDATE`
    if (!row) throw new NotFoundError({ message: 'Событие не найдено' })
    return row
}

// No waitlist: the app shows «Мест нет».
export class OrgEventFullError extends DefaultError {
    constructor() {
        super({ message: 'Мест нет', code: 'ORG_EVENT_FULL', statusCode: 409 })
    }
}

export type OrgEventRegistrationRow = {
    id: string
    eventId: string
    userId: string
    workspaceId: string
    status: 'BOOKED' | 'CANCELLED'
    bookedById: string | null
    cancelledAt: Date | null
    createdAt: Date
    updatedAt: Date
}

// Books `userId` through `workspaceId`. The caller has checked the club link
// and who may book whom; this checks the event, the consent and the places.
// Idempotent on (event, person): a live booking is returned as is (even
// through another club), a cancelled one is booked again in place.
export const bookOrgEvent = async (
    prisma: PrismaService,
    p: {
        event: OrgEventForRegistration
        workspaceId: string
        userId: string
        bookedById: string
        now: Date
    },
): Promise<{ registration: OrgEventRegistrationRow; created: boolean }> => {
    const closed = registrationClosedReason(p.event, p.now)
    if (closed) throw new BadRequestError({ message: closed })
    if (!(await hasOrgConsent(prisma, p.event.organizationId, p.userId))) {
        throw new OrgConsentRequiredError()
    }
    return prisma.$transaction(async (tx) => {
        const { capacity } = await lockEvent(tx, p.event.id)
        const existing = await tx.organizationEventRegistration.findUnique({
            where: { eventId_userId: { eventId: p.event.id, userId: p.userId } },
        })
        if (existing?.status === 'BOOKED') {
            return { registration: existing, created: false }
        }
        if (capacity !== null) {
            const booked = await tx.organizationEventRegistration.count({
                where: { eventId: p.event.id, status: 'BOOKED' },
            })
            if (booked >= capacity) throw new OrgEventFullError()
        }
        const data = {
            workspaceId: p.workspaceId,
            status: 'BOOKED' as const,
            bookedById: p.bookedById,
            cancelledAt: null,
        }
        const registration = existing
            ? await tx.organizationEventRegistration.update({
                  where: { id: existing.id },
                  data,
              })
            : await tx.organizationEventRegistration.create({
                  data: { ...data, eventId: p.event.id, userId: p.userId },
              })
        return { registration, created: true }
    })
}

// With a tournament on the event, its entry goes in the same transaction
// (SETUP only; afterwards 409 TOURNAMENT_LOCKED).
export const cancelOrgEventBooking = async (
    prisma: PrismaService,
    p: { registrationId: string; now: Date },
): Promise<OrgEventRegistrationRow> =>
    prisma.$transaction(async (tx) => {
        const current = await tx.organizationEventRegistration.findUniqueOrThrow({
            where: { id: p.registrationId },
        })
        if (current.status === 'CANCELLED') return current
        await releaseRegistrationEntryIn(tx, {
            eventId: current.eventId,
            registrationId: current.id,
        })
        await lockEvent(tx, current.eventId)
        return tx.organizationEventRegistration.update({
            where: { id: current.id },
            data: { status: 'CANCELLED', cancelledAt: p.now },
        })
    })

// BOOKED count per event.
export const bookedCounts = async (
    prisma: Pick<PrismaService, 'organizationEventRegistration'>,
    eventIds: string[],
): Promise<Map<string, number>> => {
    if (eventIds.length === 0) return new Map()
    const rows = await prisma.organizationEventRegistration.groupBy({
        by: ['eventId'],
        where: { eventId: { in: eventIds }, status: 'BOOKED' },
        _count: { _all: true },
    })
    return new Map(rows.map((r) => [r.eventId, r._count._all]))
}

export type OrgEventRegistrationView = {
    id: string
    personName: string
    clubId: string
    clubName: string
    status: 'BOOKED' | 'CANCELLED'
    // «сам» (the person or their guardian) / «записал тренер».
    bookedBy: 'SELF' | 'COACH'
    // Only when the person is visible in the registry.
    belt: RegistryBelt | null
    createdAt: Date
}

// The org's view of one event's registrations: people whose consent for the
// org is live, through clubs still ACTIVE in it. Bookings of anyone else stay
// counted (they hold a place) but are only a number — `hiddenCount`.
export const loadOrgEventRegistrations = async (
    prisma: PrismaService,
    organizationId: string,
    eventId: string,
): Promise<{ rows: OrgEventRegistrationView[]; hiddenCount: number }> => {
    const regs = await prisma.organizationEventRegistration.findMany({
        where: { eventId },
        select: {
            id: true,
            userId: true,
            workspaceId: true,
            status: true,
            bookedById: true,
            createdAt: true,
            user: { select: { firstname: true, lastname: true } },
            workspace: {
                select: {
                    name: true,
                    organizationLinks: {
                        where: { organizationId, status: 'ACTIVE' },
                        select: { id: true },
                    },
                },
            },
        },
        orderBy: { createdAt: 'asc' },
    })
    const userIds = [...new Set(regs.map((r) => r.userId))]
    const [belts, consented, guardianships] = await Promise.all([
        registryBeltsFor(prisma, organizationId, userIds),
        consentedPersonIds(prisma, organizationId, userIds),
        prisma.guardianship.findMany({
            where: { dependentId: { in: userIds }, consentAt: { not: null } },
            select: { guardianId: true, dependentId: true },
        }),
    ])
    const guardianPairs = new Set(
        guardianships.map((g) => `${g.guardianId}:${g.dependentId}`),
    )
    let hiddenCount = 0
    const rows: OrgEventRegistrationView[] = []
    for (const r of regs) {
        const visible =
            consented.has(r.userId) && r.workspace.organizationLinks.length > 0
        if (!visible) {
            if (r.status === 'BOOKED') hiddenCount += 1
            continue
        }
        const self =
            r.bookedById === null ||
            r.bookedById === r.userId ||
            guardianPairs.has(`${r.bookedById}:${r.userId}`)
        rows.push({
            id: r.id,
            personName: fullNameWithoutEmail(r.user),
            clubId: r.workspaceId,
            clubName: r.workspace.name,
            status: r.status,
            bookedBy: self ? 'SELF' : 'COACH',
            belt: belts.get(r.userId) ?? null,
            createdAt: r.createdAt,
        })
    }
    return { rows, hiddenCount }
}
