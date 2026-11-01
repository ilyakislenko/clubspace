// What an ИИ-ассистент token may read, as Prisma filters. Admin scope reads the
// whole club; a руководитель направления only what belongs to the directions
// they run (docs/design/2026-11-01-direction-managers.md): groups and their
// students, sessions and events of those directions, their ladders and
// tariffs. Club-wide rows (no direction) stay admin-only, like their writes.
// Every tool builds its queries from here, so no tool can widen the scope.
import type { AiAccess } from '../../domains/ai-assistant/ai-access'
import type { Prisma } from '../../infrastructure/prisma'
import { STAFF_ROLES } from '../../shared/decorators/roles.decorator'

export class McpScope {
    constructor(readonly access: AiAccess) {}

    get workspaceId(): string {
        return this.access.workspaceId
    }

    get isAdmin(): boolean {
        return this.access.directionIds === null
    }

    // null = every direction.
    get directionIds(): string[] | null {
        return this.access.directionIds
    }

    allowsDirection(directionId: string | null): boolean {
        const ids = this.access.directionIds
        return ids === null || (directionId !== null && ids.includes(directionId))
    }

    private inDirections() {
        const ids = this.access.directionIds
        return ids === null ? undefined : { in: ids }
    }

    directions(): Prisma.DirectionWhereInput {
        const ids = this.inDirections()
        return { workspaceId: this.workspaceId, ...(ids ? { id: ids } : {}) }
    }

    groups(): Prisma.GroupWhereInput {
        const ids = this.inDirections()
        return { workspaceId: this.workspaceId, ...(ids ? { directionId: ids } : {}) }
    }

    // The club's students: not the owner, not staff (the dashboard's rule),
    // and for a direction manager only those training in a group of theirs.
    students(): Prisma.WorkspaceMemberWhereInput {
        const ids = this.inDirections()
        return {
            workspaceId: this.workspaceId,
            NOT: [
                { role: { name: { in: [...STAFF_ROLES] } } },
                { userId: this.access.ownerId },
            ],
            ...(ids
                ? {
                      user: {
                          groupMemberships: {
                              some: {
                                  group: {
                                      workspaceId: this.workspaceId,
                                      directionId: ids,
                                  },
                              },
                          },
                      },
                  }
                : {}),
        }
    }

    // A session's direction is its group's, or its event's.
    sessions(): Prisma.AttendanceSessionWhereInput {
        const ids = this.inDirections()
        return {
            workspaceId: this.workspaceId,
            ...(ids
                ? {
                      OR: [
                          { group: { directionId: ids } },
                          { workspaceEvent: { directionId: ids } },
                      ],
                  }
                : {}),
        }
    }

    events(): Prisma.WorkspaceEventWhereInput {
        const ids = this.inDirections()
        return { workspaceId: this.workspaceId, ...(ids ? { directionId: ids } : {}) }
    }

    ladders(): Prisma.RankLadderWhereInput {
        const ids = this.inDirections()
        return { workspaceId: this.workspaceId, ...(ids ? { directionId: ids } : {}) }
    }

    // Tariffs scoped to one of the manager's directions (club-wide ones are
    // admin-only, like editing them).
    plans(): Prisma.PlanWhereInput {
        const ids = this.inDirections()
        return {
            workspaceId: this.workspaceId,
            ...(ids ? { directions: { some: { directionId: ids } } } : {}),
        }
    }
}
