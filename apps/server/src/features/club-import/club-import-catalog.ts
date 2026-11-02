// The club's gyms, directions, groups, tariffs and rank ladders, looked up by
// the names a CSV uses. Loaded once per run; entities the run creates are
// added back (with a placeholder id in a dry run) so later rows referencing
// the same name resolve to the same thing instead of creating it twice.

export type CatalogGym = { id: string; name: string }
export type CatalogDirection = { id: string; name: string }
export type CatalogGroup = {
    id: string
    name: string
    gymId: string | null
    directionId: string | null
    coachId: string
}
export type CatalogPlan = {
    id: string
    name: string
    // The tariff's direction set; empty = club-wide.
    directionIds: string[]
    price: number
    currency: string
    durationDays: number
    classCount: number | null
    isActive: boolean
    // «30 дней с первой тренировки»: a row without dates waits for the first visit.
    startsOnFirstVisit: boolean
}
export type CatalogLevel = {
    id: string
    name: string
    order: number
    maxStripes: number
    isActive: boolean
}
export type CatalogLadder = {
    id: string
    name: string
    directionId: string | null
    audience: string | null
    levels: CatalogLevel[]
}

export type CatalogData = {
    gyms: CatalogGym[]
    directions: CatalogDirection[]
    groups: CatalogGroup[]
    plans: CatalogPlan[]
    ladders: CatalogLadder[]
}

// What a row needs that the club doesn't have yet. `label` is what the
// wizard lists under «Нет в клубе».
export type CreateSpec =
    | { kind: 'gym'; name: string; label: string }
    | { kind: 'direction'; name: string; label: string }
    | {
          kind: 'group'
          name: string
          gym: Resolved<CatalogGym> | null
          direction: Resolved<CatalogDirection> | null
          label: string
      }
    | {
          kind: 'plan'
          name: string
          direction: Resolved<CatalogDirection> | null
          label: string
      }
    | {
          kind: 'level'
          name: string
          // An existing ladder of the direction, or a new one named ladderName.
          ladder: CatalogLadder | null
          ladderName: string
          direction: Resolved<CatalogDirection> | null
          label: string
      }

export type Resolved<T> = { existing: T } | { create: CreateSpec }

export type MissingKind = 'gyms' | 'directions' | 'groups' | 'plans' | 'ranks'

export const MISSING_KIND: Record<CreateSpec['kind'], MissingKind> = {
    gym: 'gyms',
    direction: 'directions',
    group: 'groups',
    plan: 'plans',
    level: 'ranks',
}

export const nameKey = (s: string): string =>
    s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

const isKidsAudience = (audience: string | null): boolean =>
    !!audience && /kid|child|дет|юн/i.test(audience)

export class ClubImportCatalog {
    constructor(readonly data: CatalogData) {}

    resolveGym(name: string): Resolved<CatalogGym> {
        const hit = this.data.gyms.find((g) => nameKey(g.name) === nameKey(name))
        return hit
            ? { existing: hit }
            : { create: { kind: 'gym', name, label: `Зал «${name}»` } }
    }

    resolveDirection(name: string): Resolved<CatalogDirection> {
        const hit = this.data.directions.find(
            (d) => nameKey(d.name) === nameKey(name),
        )
        return hit
            ? { existing: hit }
            : {
                  create: {
                      kind: 'direction',
                      name,
                      label: `Направление «${name}»`,
                  },
              }
    }

    // Groups share names across gyms («Дети 7–10» in every gym) and
    // disciplines, so the gym narrows first, then the direction: a group of
    // that direction, else one without a direction (set up before
    // directions existed). Several left without a gym to tell them apart is
    // an error, not a guess.
    resolveGroup(
        name: string,
        gym: Resolved<CatalogGym> | null,
        direction: Resolved<CatalogDirection> | null,
    ): Resolved<CatalogGroup> | { error: string } {
        let candidates = this.data.groups.filter(
            (g) => nameKey(g.name) === nameKey(name),
        )
        if (gym) {
            candidates =
                'existing' in gym
                    ? candidates.filter((g) => g.gymId === gym.existing.id)
                    : []
        }
        if (direction) {
            if ('existing' in direction) {
                const same = candidates.filter(
                    (g) => g.directionId === direction.existing.id,
                )
                candidates = same.length > 0 ? same : candidates.filter((g) => g.directionId === null)
            } else {
                candidates = candidates.filter((g) => g.directionId === null)
            }
        }
        if (candidates.length === 1) return { existing: candidates[0] }
        if (candidates.length > 1) {
            return {
                error: `В клубе несколько групп «${name}» — укажите зал, чтобы выбрать нужную`,
            }
        }
        const where = [
            gym ? ('existing' in gym ? gym.existing.name : gym.create.name) : null,
            direction
                ? 'existing' in direction
                    ? direction.existing.name
                    : direction.create.name
                : null,
        ].filter(Boolean)
        return {
            create: {
                kind: 'group',
                name,
                gym,
                direction,
                label: `Группа «${name}»${where.length ? ` (${where.join(', ')})` : ''}`,
            },
        }
    }

    // A tariff whose set contains the row's direction (the narrowest first),
    // else a club-wide one; active first.
    resolvePlan(
        name: string,
        direction: Resolved<CatalogDirection> | null,
    ): Resolved<CatalogPlan> {
        const byName = this.data.plans.filter(
            (p) => nameKey(p.name) === nameKey(name),
        )
        const dirId =
            direction && 'existing' in direction ? direction.existing.id : null
        const ranked = [
            ...byName
                .filter((p) => dirId !== null && p.directionIds.includes(dirId))
                .sort((a, b) => a.directionIds.length - b.directionIds.length),
            ...byName.filter((p) => p.directionIds.length === 0),
            ...(direction ? [] : byName.filter((p) => p.directionIds.length > 0)),
        ]
        const hit = ranked.find((p) => p.isActive) ?? ranked[0]
        return hit
            ? { existing: hit }
            : {
                  create: {
                      kind: 'plan',
                      name,
                      direction,
                      label: `Абонемент «${name}»`,
                  },
              }
    }

    // A level by name among the ladders of the row's direction (club-wide
    // ladders when the direction has none). Same name on several ladders —
    // adult and kids belts — is settled by the ladder's audience when the
    // row is a child or an adult; otherwise it is an error.
    resolveLevel(
        name: string,
        direction: Resolved<CatalogDirection> | null,
        isChild: boolean,
    ): { existing: { ladder: CatalogLadder; level: CatalogLevel } } | { create: CreateSpec } | { error: string } {
        let ladders = this.data.ladders
        if (direction) {
            if ('existing' in direction) {
                const own = ladders.filter(
                    (l) => l.directionId === direction.existing.id,
                )
                ladders = own.length > 0 ? own : ladders.filter((l) => l.directionId === null)
            } else {
                ladders = []
            }
        }
        const hits = ladders.flatMap((ladder) =>
            ladder.levels
                .filter((lv) => nameKey(lv.name) === nameKey(name))
                .map((level) => ({ ladder, level })),
        )
        let pick = hits
        if (pick.length > 1) {
            const active = pick.filter((h) => h.level.isActive)
            if (active.length > 0) pick = active
        }
        if (pick.length > 1) {
            const byAudience = pick.filter(
                (h) => isKidsAudience(h.ladder.audience) === isChild,
            )
            if (byAudience.length > 0) pick = byAudience
        }
        if (pick.length === 1) return { existing: pick[0] }
        if (pick.length > 1) {
            return {
                error: `Пояс «${name}» есть в нескольких шкалах (${pick
                    .map((h) => h.ladder.name)
                    .join(', ')}) — укажите направление`,
            }
        }
        if (ladders.length > 1) {
            return {
                error: `Пояса «${name}» нет, а шкал несколько (${ladders
                    .map((l) => l.name)
                    .join(', ')}) — добавьте его в нужную шкалу в разделе «Ранги»`,
            }
        }
        const ladder = ladders[0] ?? null
        const dirName = direction
            ? 'existing' in direction
                ? direction.existing.name
                : direction.create.name
            : null
        const ladderName = ladder?.name ?? (dirName ? `Пояса · ${dirName}` : 'Пояса')
        return {
            create: {
                kind: 'level',
                name,
                ladder,
                ladderName,
                direction,
                label: `Пояс «${name}» (шкала «${ladderName}»)`,
            },
        }
    }
}
