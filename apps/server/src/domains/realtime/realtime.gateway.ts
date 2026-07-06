import { Logger } from '@nestjs/common'
import {
    OnGatewayConnection,
    OnGatewayInit,
    WebSocketGateway,
} from '@nestjs/websockets'
import type { Server, Socket } from 'socket.io'

import { MemberStatus, PrismaService } from '../../infrastructure/prisma'
import { TokensService } from '../tokens/services/tokens.service'
import {
    RealtimeEmitter,
    userRoom,
    workspaceRoom,
} from './realtime-emitter.service'

// Pull the access token off the socket handshake: socket.io clients send it in
// `auth.token`; we also accept an Authorization header / query param as
// fallbacks.
const handshakeToken = (client: Socket): string | null => {
    const auth = client.handshake.auth as { token?: unknown } | undefined
    if (typeof auth?.token === 'string' && auth.token) return auth.token
    const header = client.handshake.headers?.authorization
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
        return header.slice(7)
    }
    const q = client.handshake.query?.token
    return typeof q === 'string' && q ? q : null
}

// Live channel for the mobile app. On connect we authenticate the handshake
// token, join the socket to a room per workspace the user can access, and let
// RealtimeEmitter fan `invalidate` events into those rooms. The app maps an
// event to a cache key and refetches — so screens update without a manual
// refresh. Read-only: the server only pushes, clients never write here.
@WebSocketGateway({
    namespace: '/realtime',
    // The mobile app is not a browser origin; allow any and rely on the JWT
    // handshake for auth rather than CORS.
    cors: { origin: '*' },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
    private readonly logger = new Logger(RealtimeGateway.name)

    constructor(
        private readonly tokens: TokensService,
        private readonly prisma: PrismaService,
        private readonly emitter: RealtimeEmitter,
    ) {}

    afterInit(server: Server): void {
        this.emitter.setServer(server)
    }

    async handleConnection(client: Socket): Promise<void> {
        const token = handshakeToken(client)
        if (!token) {
            client.disconnect()
            return
        }
        try {
            const decoded = await this.tokens.verifyToken<{ sub: string }>(
                token,
            )
            const workspaceIds = await this.userWorkspaceIds(decoded.sub)
            await Promise.all([
                client.join(userRoom(decoded.sub)),
                ...workspaceIds.map((id) => client.join(workspaceRoom(id))),
            ])
            client.data.userId = decoded.sub
            this.logger.debug(
                `connect user=${decoded.sub} rooms=${workspaceIds.length}`,
            )
        } catch {
            client.disconnect()
        }
    }

    // Every workspace the user belongs to (owner has no member row) or owns.
    private async userWorkspaceIds(userId: string): Promise<string[]> {
        const [owned, memberships] = await Promise.all([
            this.prisma.workspace.findMany({
                where: { ownerId: userId },
                select: { id: true },
            }),
            this.prisma.workspaceMember.findMany({
                where: { userId, status: MemberStatus.ACTIVE },
                select: { workspaceId: true },
            }),
        ])
        return [
            ...new Set([
                ...owned.map((w) => w.id),
                ...memberships.map((m) => m.workspaceId),
            ]),
        ]
    }
}
