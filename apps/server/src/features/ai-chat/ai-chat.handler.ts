import { Feature, IFeatureHandler } from '@shelfjs/features'

import { resolveAiAccess } from '../../domains/ai-assistant/ai-access'
import { PrismaService } from '../../infrastructure/prisma'
import { NotFoundError } from '../../shared/errors/shared.errors'
import { RbacService } from '../../shared/services/rbac.service'
import {
    AcceptAiChatWarningFeature,
    AcceptAiChatWarningFeatureResponse,
    AskAiChatFeature,
    AskAiChatFeatureResponse,
    DeleteAiChatConversationFeature,
    DeleteAiChatConversationFeatureResponse,
    GetAiChatConversationFeature,
    GetAiChatConversationFeatureResponse,
    GetAiChatStateFeature,
    GetAiChatStateFeatureResponse,
    ListAiChatConversationsFeature,
    ListAiChatConversationsFeatureResponse,
} from './ai-chat.feature'
import { AiChatService } from './ai-chat.service'
import {
    deriveTurns,
    extractEntityTokens,
    parseStoredMessages,
    parseStoredRefs,
} from './ai-chat-utils'

// Every route resolves the asker through resolveAiAccess — admins (owner,
// admin, head coach) read the whole club, a руководитель направления their
// directions, anyone else is refused — and a conversation is its author's
// alone: another staff member's id is a 404, like a missing one.

const NOT_FOUND = 'Диалог не найден'

@Feature(GetAiChatStateFeature)
export class GetAiChatStateHandler
    implements IFeatureHandler<GetAiChatStateFeature, GetAiChatStateFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly chat: AiChatService,
    ) {}

    async execute(f: GetAiChatStateFeature): Promise<GetAiChatStateFeatureResponse> {
        const access = await resolveAiAccess(this.prisma, this.rbac, {
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
        })
        return this.chat.state(access)
    }
}

@Feature(AcceptAiChatWarningFeature)
export class AcceptAiChatWarningHandler
    implements IFeatureHandler<AcceptAiChatWarningFeature, AcceptAiChatWarningFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly chat: AiChatService,
    ) {}

    async execute(f: AcceptAiChatWarningFeature): Promise<AcceptAiChatWarningFeatureResponse> {
        const access = await resolveAiAccess(this.prisma, this.rbac, {
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
        })
        await this.chat.acceptWarning(access, {
            warningVersion: f.payload.warningVersion,
            ip: f.ip,
            userAgent: f.userAgent,
        })
        return this.chat.state(access)
    }
}

@Feature(ListAiChatConversationsFeature)
export class ListAiChatConversationsHandler
    implements
        IFeatureHandler<ListAiChatConversationsFeature, ListAiChatConversationsFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(
        f: ListAiChatConversationsFeature,
    ): Promise<ListAiChatConversationsFeatureResponse> {
        const access = await resolveAiAccess(this.prisma, this.rbac, {
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
        })
        const rows = await this.prisma.aiChatConversation.findMany({
            where: { workspaceId: access.workspaceId, userId: access.userId },
            orderBy: { updatedAt: 'desc' },
            take: 100,
            select: { id: true, title: true, messages: true, createdAt: true, updatedAt: true },
        })
        return {
            data: rows.map((r) => ({
                id: r.id,
                title: r.title,
                questions: parseStoredMessages(r.messages).filter((m) => m.role === 'user').length,
                createdAt: r.createdAt.toISOString(),
                updatedAt: r.updatedAt.toISOString(),
            })),
        }
    }
}

@Feature(GetAiChatConversationFeature)
export class GetAiChatConversationHandler
    implements IFeatureHandler<GetAiChatConversationFeature, GetAiChatConversationFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly chat: AiChatService,
    ) {}

    async execute(f: GetAiChatConversationFeature): Promise<GetAiChatConversationFeatureResponse> {
        const access = await resolveAiAccess(this.prisma, this.rbac, {
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
        })
        const row = await this.prisma.aiChatConversation.findFirst({
            where: { id: f.conversationId, workspaceId: access.workspaceId, userId: access.userId },
        })
        if (!row) throw new NotFoundError({ message: NOT_FOUND })
        const messages = parseStoredMessages(row.messages)
        const turns = deriveTurns(messages)
        const entities = await this.chat.resolveEntities(
            access,
            parseStoredRefs(row.refs),
            extractEntityTokens(turns.map((t) => t.answer)),
        )
        return {
            id: row.id,
            title: row.title,
            questions: turns.length,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
            turns,
            entities,
        }
    }
}

@Feature(DeleteAiChatConversationFeature)
export class DeleteAiChatConversationHandler
    implements
        IFeatureHandler<DeleteAiChatConversationFeature, DeleteAiChatConversationFeatureResponse>
{
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
    ) {}

    async execute(
        f: DeleteAiChatConversationFeature,
    ): Promise<DeleteAiChatConversationFeatureResponse> {
        const access = await resolveAiAccess(this.prisma, this.rbac, {
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
        })
        // Usage rows stay: the monthly limit doesn't reset by deleting.
        const { count } = await this.prisma.aiChatConversation.deleteMany({
            where: { id: f.conversationId, workspaceId: access.workspaceId, userId: access.userId },
        })
        if (count === 0) throw new NotFoundError({ message: NOT_FOUND })
        return { id: f.conversationId }
    }
}

@Feature(AskAiChatFeature)
export class AskAiChatHandler implements IFeatureHandler<AskAiChatFeature, AskAiChatFeatureResponse> {
    constructor(
        private readonly prisma: PrismaService,
        private readonly rbac: RbacService,
        private readonly chat: AiChatService,
    ) {}

    async execute(f: AskAiChatFeature): Promise<AskAiChatFeatureResponse> {
        const access = await resolveAiAccess(this.prisma, this.rbac, {
            workspaceId: f.workspaceId,
            userId: f.invokerUserId,
        })
        return this.chat.prepareTurn(access, {
            conversationId: f.conversationId,
            question: f.payload.question,
        })
    }
}
