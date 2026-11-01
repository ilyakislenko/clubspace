"use client"

import {
  canManageDirection,
  isDirectionManager,
  isWorkspaceAdmin,
} from "../lib/permissions"
import { useMyMembership } from "../lib/use-my-membership"

const NONE: readonly string[] = []

export type DirectionScope = {
  isAdmin: boolean
  // A coach running one or more directions (never true for admins).
  isDirectionManager: boolean
  managedDirectionIds: readonly string[]
  // Rows of sections opened to direction managers (ranks, gradings,
  // achievements, announcements, plans): admin → always, manager → own
  // directions only, plain coach → never.
  canManageDirection: (directionId: string | null | undefined) => boolean
  // Rows of staff-wide sections every coach could already edit (events,
  // groups): only a direction manager is narrowed to their directions.
  canEditSharedRow: (directionId: string | null | undefined) => boolean
  // `DirectionSelect.allowedIds`: undefined = every direction + «Весь клуб»;
  // a manager is held to the directions they run.
  allowedDirectionIds: readonly string[] | undefined
  // Directions a list the server already narrows for managers (ladders,
  // gradings, achievements, announcements) can contain — for its filter.
  filterOptions: <T extends { id: string }>(directions: T[]) => T[]
  // Initial direction of a new row: a manager starts on their first
  // direction (club-wide is not theirs to pick), everyone else on «Весь клуб».
  defaultDirectionId: string | null
}

export function useDirectionScope(
  workspaceId: string | undefined,
): DirectionScope {
  const membership = useMyMembership(workspaceId)
  const manager = isDirectionManager(membership)
  const managedDirectionIds = manager
    ? (membership?.managedDirectionIds ?? NONE)
    : NONE
  return {
    isAdmin: isWorkspaceAdmin(membership),
    isDirectionManager: manager,
    managedDirectionIds,
    canManageDirection: (directionId) =>
      canManageDirection(membership, directionId),
    canEditSharedRow: (directionId) =>
      !manager || canManageDirection(membership, directionId),
    allowedDirectionIds: manager ? managedDirectionIds : undefined,
    filterOptions: (directions) =>
      manager
        ? directions.filter((d) => managedDirectionIds.includes(d.id))
        : directions,
    defaultDirectionId: manager ? (managedDirectionIds[0] ?? null) : null,
  }
}
