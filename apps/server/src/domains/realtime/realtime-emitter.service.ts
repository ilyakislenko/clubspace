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
