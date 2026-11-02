"use client"

import type { Direction } from "../../shared/api/directions"
import type { GroupSummary } from "../../shared/api/groups"
import { groupOptionLabel } from "../../shared/lib/group-label"
import type { DirectionScope } from "../../shared/workspace/use-direction-scope"
import { toggleId } from "../directions/direction-scope"
import { DirectionSelect } from "../directions/DirectionSelect"
import {
  GROUPS_REMOVED_TEXT,
  type AnnouncementTarget,
  type AnnouncementTargetKind,
} from "./announcement-target"

const KIND_LABELS: Record<AnnouncementTargetKind, string> = {
  club: "Весь клуб",
  direction: "Направление",
  groups: "Группы",
}

const chipClass = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-medium transition ${
    active
      ? "border-primary bg-primary/10 text-primary"
      : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
  }`

/**
 * «Аудитория»: the whole club, a direction or chosen groups (with the hall in
 * each label). A direction manager is offered only their directions and the
 * groups of them — never the whole club (server rule). Renders nothing when
 * the club has neither directions nor groups.
 */
export function AnnouncementTargetPicker({
  id,
  value,
  onChange,
  directions,
  groups,
  scope,
  groupsRemoved = false,
}: {
  id: string
  value: AnnouncementTarget
  onChange: (target: AnnouncementTarget) => void
  directions: Direction[]
  groups: GroupSummary[]
  scope: DirectionScope
  /** Every group the announcement was addressed to was deleted since. */
  groupsRemoved?: boolean
}) {
  // Groups already chosen stay visible so editing never silently drops one.
  const offered = groups.filter(
    (g) =>
      value.groupIds.includes(g.id) ||
      scope.canManageDirection(g.direction?.id ?? null),
  )
  const kinds: AnnouncementTargetKind[] = [
    ...(scope.allowedDirectionIds === undefined || value.kind === "club"
      ? (["club"] as const)
      : []),
    ...(directions.length > 0 ? (["direction"] as const) : []),
    // Kept while chosen: an announcement whose groups were all deleted (or a
    // club left without groups) must not fall back to another kind silently.
    ...(offered.length > 0 || value.kind === "groups"
      ? (["groups"] as const)
      : []),
  ]
  if (kinds.length < 2 && value.kind === "club") return null

  const pick = (kind: AnnouncementTargetKind) => {
    if (kind === "club") {
      onChange({ kind, directionId: null, groupIds: [] })
    } else if (kind === "direction") {
      const allowed = directions.filter(
        (d) =>
          d.isActive &&
          (!scope.allowedDirectionIds ||
            scope.allowedDirectionIds.includes(d.id)),
      )
      onChange({
        kind,
        directionId:
          value.directionId ?? scope.defaultDirectionId ?? allowed[0]?.id ?? null,
        groupIds: [],
      })
    } else {
      onChange({ kind, directionId: null, groupIds: value.groupIds })
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor={`${id}-kind`} className="text-muted-foreground">
          Аудитория:
        </label>
        <select
          id={`${id}-kind`}
          value={value.kind}
          onChange={(e) => pick(e.target.value as AnnouncementTargetKind)}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        {value.kind === "direction" && (
          <DirectionSelect
            id={`${id}-direction`}
            label=""
            directions={directions}
            value={value.directionId}
            onChange={(directionId) => onChange({ ...value, directionId })}
            // «Весь клуб» is its own choice above.
            allowedIds={
              scope.allowedDirectionIds ??
              directions.filter((d) => d.isActive).map((d) => d.id)
            }
            triggerClassName="h-8 w-48"
          />
        )}
      </div>
      {value.kind === "groups" && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Группы">
          {offered.map((g) => {
            const active = value.groupIds.includes(g.id)
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onChange({ ...value, groupIds: toggleId(value.groupIds, g.id) })
                }
                className={chipClass(active)}
              >
                {groupOptionLabel(g)}
              </button>
            )
          })}
        </div>
      )}
      {groupsRemoved && value.kind === "groups" && value.groupIds.length === 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          {GROUPS_REMOVED_TEXT}. Выберите группы или другую аудиторию —
          без этого сохранение оставит его скрытым.
        </p>
      )}
    </div>
  )
}
