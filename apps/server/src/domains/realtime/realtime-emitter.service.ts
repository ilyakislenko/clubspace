import { Injectable, Logger } from '@nestjs/common'
import type { Server } from 'socket.io'

// Socket.io room name for a workspace's live channel. Every connected member of
// the workspace is joined here (see RealtimeGateway), so an emit fans out to
// exactly that club.
export const workspaceRoom = (workspaceId: string): string =>
    `workspace:${workspaceId}`

// Per-user room for user-scoped channels (e.g. the notifications inbox) that
// aren't tied to a single workspace. The client keys these caches as
// "<resource>:me", so we tag the emit with workspaceId "me".
export const userRoom = (userId: string): string => `user:${userId}`
const USER_SCOPE = 'me'

// Thin publish side of the realtime layer. Feature handlers inject this and
// call `invalidate` after a change; the gateway wires the live Server instance
// in on init. Decoupling it from the gateway keeps handlers from depending on
// socket.io internals and makes the no-op-when-unconnected path trivial.
@Injectable()
export class RealtimeEmitter {
    private readonly logger = new Logger(RealtimeEmitter.name)
    private server: Server | null = null

    setServer(server: Server): void {
        this.server = server
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
