import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import type { Server } from 'socket.io'

// Every connected member of the workspace is joined here (see RealtimeGateway).
export const workspaceRoom = (workspaceId: string): string =>
    `workspace:${workspaceId}`

// User-scoped channels. The client keys these caches as "<resource>:me", so
// the emit is tagged with workspaceId "me".
export const userRoom = (userId: string): string => `user:${userId}`
const USER_SCOPE = 'me'

// Window over which bursty workspace invalidations (check-ins at class start)
// are merged into one emit per club.
export const INVALIDATE_COALESCE_MS = 2_000

// Publish side of the realtime layer, kept separate from the gateway so
// handlers don't depend on socket.io and the unconnected path is a no-op.
@Injectable()
export class RealtimeEmitter implements OnModuleDestroy {
    private readonly logger = new Logger(RealtimeEmitter.name)
    private server: Server | null = null
    // workspaceId -> resources waiting for the coalesced emit.
    private readonly pending = new Map<string, Set<string>>()
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

    setServer(server: Server): void {
        this.server = server
    }

    onModuleDestroy(): void {
        for (const timer of this.timers.values()) clearTimeout(timer)
        this.timers.clear()
        this.pending.clear()
    }

    /**
     * Like `invalidate`, but merged per workspace: the first call opens a
     * window of INVALIDATE_COALESCE_MS and every resource named before it
     * closes goes out in one emit. Use for high-churn writes where every
     * connected member would otherwise refetch once per write.
     */
    invalidateCoalesced(workspaceId: string, resources: string[]): void {
        if (!this.server || resources.length === 0) return
        let set = this.pending.get(workspaceId)
        if (!set) {
            set = new Set()
            this.pending.set(workspaceId, set)
        }
        for (const r of resources) set.add(r)
        if (this.timers.has(workspaceId)) return
        const timer = setTimeout(() => {
            this.timers.delete(workspaceId)
            const due = this.pending.get(workspaceId)
            this.pending.delete(workspaceId)
            if (due) this.invalidate(workspaceId, [...due])
        }, INVALIDATE_COALESCE_MS)
        // Never hold the process open on shutdown for a cache hint.
        timer.unref?.()
        this.timers.set(workspaceId, timer)
    }

    /**
     * Revalidate workspace-keyed resources ("<resource>:<workspaceId>") for
     * just these users, on their own rooms — e.g. a member's own abonement
     * after a check-in, without making the whole club refetch.
     */
    invalidateUsersInWorkspace(
        userIds: string[],
        workspaceId: string,
        resources: string[],
    ): void {
        if (!this.server || userIds.length === 0 || resources.length === 0) {
            return
        }
        this.server
            .to(userIds.map(userRoom))
            .emit('invalidate', { workspaceId, resources })
        this.logger.debug(
            `invalidate users=${userIds.length} ws=${workspaceId} [${resources.join(', ')}]`,
        )
    }

    /**
     * Put the users' open sockets into the workspace room, so a member who was
     * approved or added while connected receives the club's events at once.
     */
    joinWorkspaceRoom(userIds: string[], workspaceId: string): void {
        if (!this.server || userIds.length === 0) return
        this.server
            .in(userIds.map(userRoom))
            .socketsJoin(workspaceRoom(workspaceId))
    }

    /**
     * Take the users' open sockets out of the workspace room: a removed or
     * blocked member stops receiving the club's events without reconnecting.
     */
    leaveWorkspaceRoom(userIds: string[], workspaceId: string): void {
        if (!this.server || userIds.length === 0) return
        this.server
            .in(userIds.map(userRoom))
            .socketsLeave(workspaceRoom(workspaceId))
    }

    /**
     * Tell every connected member of a workspace to revalidate the given
     * resources. `resources` are client cache-key prefixes (e.g.
     * "announcements", "ranks", "leaderboard") — the mobile cache maps each to
     * the matching `<resource>:<workspaceId>` key and refetches. Safe to call
     * even when nothing is connected (no-op).
     */
    invalidate(workspaceId: string, resources: string[]): void {
        if (!this.server || resources.length === 0) return
        this.server
            .to(workspaceRoom(workspaceId))
            .emit('invalidate', { workspaceId, resources })
        this.logger.debug(
            `invalidate ws=${workspaceId} [${resources.join(', ')}]`,
        )
    }

    /**
     * Push a single list mutation to a workspace's clients so they patch the
     * cached list in place instead of refetching it. `list` is the client cache
     * key prefix (e.g. "announcements"); the client applies `op` to the item by
     * its `id` in the `<list>:<workspaceId>` cache. Prefer this over
     * `invalidate` for high-churn lists — it's instant and network-free.
     */
    emitListDelta(
        workspaceId: string,
        list: string,
        op: 'create' | 'update' | 'delete',
        item: { id: string } & Record<string, unknown>,
    ): void {
        if (!this.server) return
        this.server
            .to(workspaceRoom(workspaceId))
            .emit('delta', { workspaceId, list, op, item })
        this.logger.debug(`delta ws=${workspaceId} ${list} ${op} ${item.id}`)
    }

    /**
     * User-scoped list delta (e.g. a new notification in the inbox) to a set of
     * users' own rooms. Tagged with the "me" scope so it maps to the client's
     * "<list>:me" cache key.
     */
    emitListDeltaUsers(
        userIds: string[],
        list: string,
        op: 'create' | 'update' | 'delete',
        item: { id: string } & Record<string, unknown>,
    ): void {
        if (!this.server || userIds.length === 0) return
        this.server
            .to(userIds.map(userRoom))
            .emit('delta', { workspaceId: USER_SCOPE, list, op, item })
        this.logger.debug(
            `delta users=${userIds.length} ${list} ${op} ${item.id}`,
        )
    }

    /**
     * Revalidate user-scoped resources (e.g. the notifications inbox) for a set
     * of users, each on their own socket room. Tagged with the "me" scope so it
     * maps to the client's "<resource>:me" cache keys.
     */
    invalidateUsers(userIds: string[], resources: string[]): void {
        if (!this.server || userIds.length === 0 || resources.length === 0) {
            return
        }
        this.server
            .to(userIds.map(userRoom))
            .emit('invalidate', { workspaceId: USER_SCOPE, resources })
        this.logger.debug(
            `invalidate users=${userIds.length} [${resources.join(', ')}]`,
        )
    }
}
