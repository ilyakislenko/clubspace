import { localDateInTz } from '../../../features/attendance/attendance-utils'
import { registryLevelsFor } from '../../../domains/organizations/registry'
import { entryFacts, matchDivision } from '../../../domains/tournaments/divisions'
import { nextMatchFor } from '../../../domains/tournaments/schedule'
import {
    type EntryView,
    loadDivisionCriteria,
    loadEntryViews,
    loadLevelRefs,
    loadSchedule,
    TOURNAMENT_SELECT,
    type TournamentRow,
} from '../../../domains/tournaments/tournament-read'
import type { EntryConfirmation } from '../../../domains/tournaments/tournament-store'
import { type TournamentWords, tournamentWords } from '../../../domains/tournaments/tournament-words'
import { PrismaService } from '../../../infrastructure/prisma'
import { DefaultError } from '../../../shared/errors/default.error'
import { NotFoundError } from '../../../shared/errors/shared.errors'
import type { CoachContext, RbacService } from '../../../shared/services/rbac.service'
import { type ClubOrgEventRow, loadVisibleOrgEvent } from '../events/club-org-events'
import { type ClubTournamentNextMatch, type ClubViewer, serializeClubPerson } from './schemas'

// The registry shows no level and the coach picked none («Укажите пояс …» in
// grappling, «Укажите уровень …» elsewhere).
export class TournamentLevelRequiredError extends DefaultError {
    constructor(words: TournamentWords) {
        super({
            message: `Укажите ${words.levelAcc} по стандарту федерации`,
            code: 'TOURNAMENT_LEVEL_REQUIRED',
            statusCode: 400,
        })
    }
}

// What a coach's confirmation writes: the level from the registry (else the
// picked one, else none when `required` is false) and the one fitting
// division by the declared weight («Категорию назначит федерация» = null).
export const resolveConfirmation = async (
    prisma: PrismaService,
    p: {
        tournament: TournamentRow
        entry: {
            userId: string
            sex: 'FEMALE' | 'MALE'
            birthYear: number
            declaredWeightG: number | null
            weighedWeightG: number | null
        }
        coachId: string
        pickedLevelId: string | null
        required: boolean
    },
): Promise<EntryConfirmation> => {
    const organizationId = p.tournament.organizationId
    const words = tournamentWords(p.tournament.organization.type)
    const registry = (await registryLevelsFor(prisma, organizationId, [p.entry.userId])).get(
        p.entry.userId,
    )
    let level: { id: string; templateId: string; order: number; name: string } | null = null
    let picked = false
    if (registry) {
        level = { ...registry, id: registry.templateLevelId }
    } else if (p.pickedLevelId) {
        const refs = await loadLevelRefs(prisma, organizationId, [p.pickedLevelId])
        level = refs.get(p.pickedLevelId) ?? null
        if (!level) throw new NotFoundError({ message: `${words.levelNom} не найден в стандартах федерации` })
        picked = true
    }
    const divisions = await loadDivisionCriteria(prisma, p.tournament.id)
    // A level is needed only when some division is defined on a standard.
    if (!level && p.required && divisions.some((d) => d.templateId !== null)) {
        throw new TournamentLevelRequiredError(words)
    }
    const facts = entryFacts(
        p.entry,
        localDateInTz(p.tournament.event.startAt, p.tournament.event.timezone),
        level,
    )
    return {
        confirmedById: p.coachId,
        templateLevelId: level?.id ?? null,
        levelName: level?.name ?? null,
        levelSetById: picked ? p.coachId : null,
        divisionId: matchDivision(facts, divisions)?.id ?? null,
    }
}

// The students whose entries a coach confirms and follows: own groups (and
// managed directions); null = admin scope, the whole club. The same rule as
// assertCanWriteMember, so a count never names an entry the coach can't open.
export const coachEntryScope = async (
    rbac: RbacService,
    ctx: CoachContext,
): Promise<string[] | null> =>
    rbac.canWriteAllGroups(ctx) ? null : rbac.ownGroupMemberIds(ctx)

// The tournament of a federation event this viewer sees in this club, or
// 404 (no existence leak: an event the club doesn't get is unknown).
export const loadClubTournament = async (
    prisma: PrismaService,
    p: { workspaceId: string; eventId: string; staff: boolean },
): Promise<{ event: ClubOrgEventRow; tournament: TournamentRow }> => {
    const event = await loadVisibleOrgEvent(prisma, {
        workspaceId: p.workspaceId,
        eventId: p.eventId,
        staff: p.staff,
        now: new Date(),
    })
    const tournament = await prisma.tournament.findUnique({
        where: { eventId: event.id },
        select: TOURNAMENT_SELECT,
    })
    if (!tournament) throw new NotFoundError({ message: 'Турнир не найден' })
    return { event, tournament }
}

// UTC year of a stored birth date (dates of birth are stored at midnight UTC).
export const birthYearOf = (dateOfBirth: Date | null): number | null =>
    dateOfBirth ? dateOfBirth.getUTCFullYear() : null

// «Следующая схватка» of each of `entries` while the tournament runs: mat,
// matches ahead, the opponent or the match whose winner it will be.
export const loadNextMatches = async (
    prisma: PrismaService,
    t: TournamentRow,
    entries: EntryView[],
    viewer: ClubViewer,
): Promise<Map<string, ClubTournamentNextMatch>> => {
    const out = new Map<string, ClubTournamentNextMatch>()
    const live = entries.filter((e) => e.status === 'CONFIRMED' && e.place === null)
    if (t.status !== 'RUNNING' || live.length === 0) return out
    const { divisions, matches } = await loadSchedule(prisma, t.id)
    const nexts = new Map(live.map((e) => [e.id, nextMatchFor(e.id, divisions, matches)]))
    const others = [...nexts.values()].flatMap((n) =>
        n
            ? [n.opponentEntryId, n.waitingFor?.entryAId ?? null, n.waitingFor?.entryBId ?? null]
            : [],
    )
    const people = await loadEntryViews(prisma, t.organizationId, {
        tournamentId: t.id,
        ids: [...new Set(others.filter((id): id is string => !!id))],
    })
    const byId = new Map(people.map((p) => [p.id, p]))
    const person = (id: string | null | undefined) => {
        const p = id ? byId.get(id) : undefined
        return p ? serializeClubPerson(p, viewer) : null
    }
    for (const [entryId, n] of nexts) {
        if (!n) continue
        out.set(entryId, {
            mat: n.mat,
            ahead: n.ahead,
            opponent: person(n.opponentEntryId),
            waitingFor: n.waitingFor
                ? { entryA: person(n.waitingFor.entryAId), entryB: person(n.waitingFor.entryBId) }
                : null,
        })
    }
    return out
}