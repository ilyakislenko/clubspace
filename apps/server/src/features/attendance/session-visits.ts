// Spending a visit on an abonement — the write side of the visit precedence
// (domains/subscriptions/visit-abonement.ts) shared by coach marking, the
// abonement change, self check-in and the roster/preview reads.
import { loadSessionDirectionId } from '../../domains/directions/direction-scope'
import { scopeCoversDirection } from '../../domains/subscriptions/current-subscriptions'
import {
    loadVisitCandidates,
    rankVisitAbonements,
    type LoadedVisitCandidate,
    type VisitAbonement,
} from '../../domains/subscriptions/visit-abonement'
import { directionRefSelect } from '../../domains/directions/direction-ref'
import { Prisma, type PrismaTransactionClientType } from '../../infrastructure/prisma'

export const VISIT_ABONEMENT_REFUSED_MESSAGE =
    'Этот абонемент нельзя списать на эту тренировку'

type Db = Pick<PrismaTransactionClientType, 'subscription' | 'attendanceSession'>

export type SessionVisitOptions = {
    // Every current abonement of each member (frozen ones too).
    candidates: Map<string, LoadedVisitCandidate[]>
    // Eligible ones for this session, in precedence order (first = default).
    ranked: Map<string, LoadedVisitCandidate[]>
    sessionDirectionId: string | null
}

// Current abonements of these members and which of them this session may be
// spent on. One query for all members; the session's direction is looked up
// only when some abonement is scoped (a club without directions never needs it).
export const loadSessionVisitOptions = async (
    db: Db,
    p: {
        workspaceId: string
        sessionId: string
        // The session's club-local day (freezes are club-local days).
        dayYmd: string
        userIds: readonly string[]
        now: Date
    },
): Promise<SessionVisitOptions> => {
    const candidates = await loadVisitCandidates(db, p)
    const scoped = [...candidates.values()].some((list) =>
        list.some((c) => c.directionIds.length > 0),
    )
    const sessionDirectionId = scoped
        ? await loadSessionDirectionId(db, p.sessionId)
        : null
    const ranked = new Map<string, LoadedVisitCandidate[]>()
    for (const [userId, list] of candidates) {
        ranked.set(
            userId,
            rankVisitAbonements(list, { sessionDirectionId, now: p.now }),
        )
    }
    return { candidates, ranked, sessionDirectionId }
}

// A class pack covering this class has run out — what a member with no
// eligible abonement is shown as "0 left" (one used-up pack always read so).
export const exhaustedPackCovers = (
    candidates: readonly LoadedVisitCandidate[],
    sessionDirectionId: string | null,
): boolean =>
    candidates.some(
        (c) =>
            c.classesTotal !== null &&
            (c.classesRemaining ?? 0) <= 0 &&
            scopeCoversDirection(c.directionIds, sessionDirectionId),
    )

// The abonements visits were already attributed to, as clients show them. Read
// by id: the used one may no longer be eligible (0 left, expired) and still is
// what the visit was spent on.
export const loadUsedAbonements = async (
    db: Pick<PrismaTransactionClientType, 'subscription'>,
    ids: readonly string[],
): Promise<Map<string, VisitAbonement>> => {
    const out = new Map<string, VisitAbonement>()
    if (ids.length === 0) return out
    const rows = await db.subscription.findMany({
        where: { id: { in: [...new Set(ids)] } },
        select: {
            id: true,
            classesTotal: true,
            classesRemaining: true,
            endDate: true,
            plan: { select: { name: true } },
            directions: {
                select: { direction: directionRefSelect },
                orderBy: [
                    { direction: { order: 'asc' } },
                    { direction: { name: 'asc' } },
                ],
            },
        },
    })
    for (const r of rows) {
        out.set(r.id, {
            subscriptionId: r.id,
            planName: r.plan.name,
            classesTotal: r.classesTotal,
            classesRemaining: r.classesRemaining,
            endDate: r.endDate ? r.endDate.toISOString() : null,
            directions: r.directions.map((d) => d.direction),
        })
    }
    return out
}

export type VisitCharge = {
    userId: string
    // The abonement it is attributed to (null = none could pay).
    usedId: string | null
    // The pack a class was really deducted from (refunded on un-mark).
    consumedId: string | null
    // Classes left on the used pack after this visit; null = time-based / none.
    classesRemaining: number | null
}

// Spends one visit of each member on the first of `options` (the chosen
// abonement, then the rest of the precedence). A class pack is decremented
// with the guarded `classesRemaining > 0` update, all packs of one round in one
// statement; a time-based abonement only counts the visit. When a guarded
// decrement loses a race (another check-in took the last class meanwhile) the
// member falls through to their next option, and with none left the visit
// stays unattributed — the same as a member without an abonement. Then the
// records are tagged in ONE statement for the whole roster.
export const chargeVisits = async (
    tx: Pick<PrismaTransactionClientType, 'subscription' | '$executeRaw'>,
    sessionId: string,
    plans: ReadonlyArray<{
        userId: string
        options: readonly LoadedVisitCandidate[]
    }>,
): Promise<VisitCharge[]> => {
    const done = new Map<string, VisitCharge>()
    let pending = plans
        .filter((p) => p.options.length > 0)
        .map((p) => ({ ...p, at: 0 }))
    while (pending.length > 0) {
        const packs: typeof pending = []
        for (const p of pending) {
            const c = p.options[p.at]
            if (c.classesTotal === null) {
                done.set(p.userId, {
                    userId: p.userId,
                    usedId: c.id,
                    consumedId: null,
                    classesRemaining: null,
                })
            } else {
                packs.push(p)
            }
        }
        if (packs.length === 0) break
        const drawn = await tx.subscription.updateManyAndReturn({
            where: {
                id: { in: packs.map((p) => p.options[p.at].id) },
                classesRemaining: { gt: 0 },
            },
            data: { classesRemaining: { decrement: 1 } },
            select: { id: true, classesRemaining: true },
        })
        const left = new Map(drawn.map((d) => [d.id, d.classesRemaining]))
        pending = []
        for (const p of packs) {
            const id = p.options[p.at].id
            if (left.has(id)) {
                done.set(p.userId, {
                    userId: p.userId,
                    usedId: id,
                    consumedId: id,
                    classesRemaining: left.get(id) ?? null,
                })
            } else if (p.at + 1 < p.options.length) {
                pending.push({ ...p, at: p.at + 1 })
            }
        }
    }

    const charges = [...done.values()]
    if (charges.length > 0) {
        await tx.$executeRaw`
            UPDATE "AttendanceRecord" AS ar
            SET "usedSubscriptionId" = v.used_id,
                "consumedSubscriptionId" = v.consumed_id
            FROM (VALUES ${Prisma.join(
                charges.map(
                    (c) =>
                        Prisma.sql`(${c.userId}::uuid, ${c.usedId}::uuid, ${c.consumedId}::uuid)`,
                ),
            )}) AS v(user_id, used_id, consumed_id)
            WHERE ar."sessionId" = ${sessionId}::uuid
              AND ar."userId" = v.user_id
        `
    }
    return charges
}

// Gives back the class a visit deducted. Only a live pack takes it back: a
// used-up pack is closed as EXPIRED and a cancelled one is gone — refunding
// there would resurrect a balance nobody can spend. Clamped at the pack size.
export const refundConsumedClass = async (
    tx: Pick<PrismaTransactionClientType, 'subscription'>,
    subscriptionId: string,
): Promise<void> => {
    const sub = await tx.subscription.findUnique({
        where: { id: subscriptionId },
        select: {
            id: true,
            status: true,
            classesRemaining: true,
            classesTotal: true,
        },
    })
    if (
        sub &&
        sub.status === 'ACTIVE' &&
        sub.classesRemaining != null &&
        sub.classesTotal != null &&
        sub.classesRemaining < sub.classesTotal
    ) {
        await tx.subscription.update({
            where: { id: sub.id },
            data: { classesRemaining: { increment: 1 } },
        })
    }
}
