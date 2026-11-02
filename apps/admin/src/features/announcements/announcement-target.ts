import type { Announcement } from "../../shared/api/announcements"
import { groupOptionLabel } from "../../shared/lib/group-label"
import {
  ALL_DIRECTIONS,
  matchesDirectionFilter,
  type DirectionFilterValue,
} from "../directions/DirectionFilter"

// Who an announcement is addressed to: the whole club, one direction, or a
// set of groups — never a direction and groups together (server rule).
export type AnnouncementTargetKind = "club" | "direction" | "groups"

export type AnnouncementTarget = {
  kind: AnnouncementTargetKind
  directionId: string | null
  groupIds: string[]
}

export const CLUB_TARGET: AnnouncementTarget = {
  kind: "club",
  directionId: null,
  groupIds: [],
}

/** A new announcement: a direction manager starts on their direction. */
export const initialTarget = (
  defaultDirectionId: string | null,
): AnnouncementTarget =>
  defaultDirectionId
    ? { kind: "direction", directionId: defaultDirectionId, groupIds: [] }
    : CLUB_TARGET

// Every target group deleted since: still «Группы» with none chosen — the
// announcement matches nobody, it must not read (or save) as «Весь клуб».
export const targetOf = (a: Announcement): AnnouncementTarget =>
  a.groups.length > 0 || a.groupsRemoved
    ? { kind: "groups", directionId: null, groupIds: a.groups.map((g) => g.id) }
    : a.direction
      ? { kind: "direction", directionId: a.direction.id, groupIds: [] }
      : CLUB_TARGET

/** The edit keeps the deleted groups as they were: nobody sees it still. */
const keepsRemovedGroups = (
  t: AnnouncementTarget,
  a: Pick<Announcement, "groupsRemoved">,
): boolean => a.groupsRemoved && t.kind === "groups" && t.groupIds.length === 0

export type TargetPayload = { directionId: string | null; groupIds: string[] }

/** The API payload: the target not chosen is always cleared. */
export const targetPayload = (t: AnnouncementTarget): TargetPayload => ({
  directionId: t.kind === "direction" ? t.directionId : null,
  groupIds: t.kind === "groups" ? t.groupIds : [],
})

/** «Группы» needs at least one group, «Направление» a direction. */
export const isTargetComplete = (t: AnnouncementTarget): boolean =>
  t.kind === "club" ||
  (t.kind === "direction" ? t.directionId !== null : t.groupIds.length > 0)

/**
 * An edit may save the text of an announcement whose groups were all deleted
 * without choosing new ones: the target is not sent, so it stays closed —
 * opening it to the club takes choosing «Весь клуб».
 */
export const isEditTargetComplete = (
  t: AnnouncementTarget,
  a: Pick<Announcement, "groupsRemoved">,
): boolean => isTargetComplete(t) || keepsRemovedGroups(t, a)

export const editTargetPayload = (
  t: AnnouncementTarget,
  a: Pick<Announcement, "groupsRemoved">,
): Partial<TargetPayload> =>
  keepsRemovedGroups(t, a) ? {} : targetPayload(t)

export const GROUPS_REMOVED_TEXT =
  "Группы удалены — объявление никому не показывается"

/**
 * Direction filter of the staff list: an announcement addressed to groups
 * belongs to a direction when every one of its groups does (as on the server).
 * One whose groups were all deleted belongs to none — and not to the club.
 */
export const matchesTargetFilter = (
  filter: DirectionFilterValue,
  a: Pick<Announcement, "direction" | "groups" | "groupsRemoved">,
): boolean =>
  a.groupsRemoved
    ? filter === ALL_DIRECTIONS
    : a.groups.length === 0
      ? matchesDirectionFilter(filter, a.direction?.id)
      : filter === ALL_DIRECTIONS ||
        a.groups.every((g) => g.directionId === filter)

/** «Взрослые · Манеж, Дети · Центр» — the hall tells same-named groups apart. */
export const groupsLabel = (groups: Announcement["groups"]): string =>
  groups.map((g) => groupOptionLabel(g)).join(", ")

/** The confirmation before a publish that sends a push. */
export const publishConfirmText = (
  audience: string,
  target: { directionName: string | null; groups: Announcement["groups"] },
): string => {
  const who =
    audience === "EXPIRING"
      ? "участникам с истекающим абонементом"
      : "всем участникам"
  if (target.groups.length > 0) {
    const names = target.groups
      .map((g) => `«${groupOptionLabel(g)}»`)
      .join(", ")
    return `Опубликовать и отправить уведомление ${who} ${
      target.groups.length === 1 ? "группы" : "групп"
    } ${names}?`
  }
  return target.directionName
    ? `Опубликовать и отправить уведомление ${who} направления «${target.directionName}»?`
    : `Опубликовать и отправить уведомление ${who}?`
}
