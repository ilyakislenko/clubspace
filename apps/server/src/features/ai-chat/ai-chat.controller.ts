import {
    Body,
    Controller,
    Delete,
    Get,
    Headers,
    Ip,
    Logger,
    Param,
    ParseUUIDPipe,
    Post,
    Res,
    UseGuards,
} from '@nestjs/common'
import { ApiOkResponse, ApiProduces } from '@nestjs/swagger'
import { FeaturesBus } from '@shelfjs/features'
import type { Response } from 'express'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    AcceptAiChatWarningFeature,
    type AcceptAiChatWarningFeatureResponse,
    AcceptAiChatWarningInputSchema,
    AiChatConversationOutputSchema,
    AiChatStateOutputSchema,
    type AiChatStreamEvent,
    AskAiChatFeature,
    type AskAiChatFeatureResponse,
    AskAiChatInputSchema,
    DeleteAiChatConversationFeature,
    type DeleteAiChatConversationFeatureResponse,
    DeleteAiChatConversationOutputSchema,
    GetAiChatConversationFeature,
    type GetAiChatConversationFeatureResponse,
    GetAiChatStateFeature,
    type GetAiChatStateFeatureResponse,
    ListAiChatConversationsFeature,
    type ListAiChatConversationsFeatureResponse,
    ListAiChatConversationsOutputSchema,
} from './ai-chat.feature'

class AiChatStateOutput extends createZodDto(AiChatStateOutputSchema) {}
class AcceptAiChatWarningInput extends createZodDto(AcceptAiChatWarningInputSchema) {}
class ListAiChatConversationsOutput extends createZodDto(ListAiChatConversationsOutputSchema) {}
class AiChatConversationOutput extends createZodDto(AiChatConversationOutputSchema) {}
class DeleteAiChatConversationOutput extends createZodDto(DeleteAiChatConversationOutputSchema) {}
class AskAiChatInput extends createZodDto(AskAiChatInputSchema) {}

// «ИИ-ассистент» chat (sidebar → Аналитика). COACHING_ROLES so a руководитель
// направления reaches the handlers; resolveAiAccess there refuses plain coaches.
@Controller('workspaces/:workspaceId/ai-chat')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class AiChatController {
    private readonly logger = new Logger(AiChatController.name)

    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: AiChatStateOutput })
    async getAiChatState(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<GetAiChatStateFeature, GetAiChatStateFeatureResponse>(
            new GetAiChatStateFeature(workspaceId, user.userId),
        )
    }

    @Post('consent')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: AiChatStateOutput })
    async acceptAiChatWarning(
        @Param('workspaceId') workspaceId: string,
        @Body() body: AcceptAiChatWarningInput,
        @CurrentUser() user: CurrentUserPayload,
        @Ip() ip: string | undefined,
        @Headers('user-agent') userAgent: string | undefined,
    ) {
        return this.bus.execute<AcceptAiChatWarningFeature, AcceptAiChatWarningFeatureResponse>(
            new AcceptAiChatWarningFeature(body, workspaceId, user.userId, ip ?? null, userAgent ?? null),
        )
    }

    @Get('conversations')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: ListAiChatConversationsOutput })
    async listAiChatConversations(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<ListAiChatConversationsFeature, ListAiChatConversationsFeatureResponse>(
            new ListAiChatConversationsFeature(workspaceId, user.userId),
        )
    }

    @Get('conversations/:conversationId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: AiChatConversationOutput })
    async getAiChatConversation(
        @Param('workspaceId') workspaceId: string,
        @Param('conversationId', ParseUUIDPipe) conversationId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<GetAiChatConversationFeature, GetAiChatConversationFeatureResponse>(
            new GetAiChatConversationFeature(workspaceId, conversationId, user.userId),
        )
    }

    @Delete('conversations/:conversationId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: DeleteAiChatConversationOutput })
    async deleteAiChatConversation(
        @Param('workspaceId') workspaceId: string,
        @Param('conversationId', ParseUUIDPipe) conversationId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            DeleteAiChatConversationFeature,
            DeleteAiChatConversationFeatureResponse
        >(new DeleteAiChatConversationFeature(workspaceId, conversationId, user.userId))
    }

    // Asks one question; the answer streams back as server-sent events
    // (AiChatStreamEvent: start, text, tool, entities, done | error). Refusals
    // (access, consent, limit, «не настроено») come before the stream as plain
    // JSON errors. The conversation id is the admin's: a new one starts a
    // conversation. Closing the request stops the model.
    @Post('conversations/:conversationId/messages')
    @Roles(COACHING_ROLES)
    @ApiProduces('text/event-stream')
    @ApiOkResponse({ description: 'Поток server-sent events с ответом ассистента' })
    async askAiChat(
        @Param('workspaceId') workspaceId: string,
        @Param('conversationId', ParseUUIDPipe) conversationId: string,
        @Body() body: AskAiChatInput,
        @CurrentUser() user: CurrentUserPayload,
        @Res() res: Response,
    ) {
        const turn = await this.bus.execute<AskAiChatFeature, AskAiChatFeatureResponse>(
            new AskAiChatFeature(body, workspaceId, conversationId, user.userId),
        )
        res.status(200)
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
        // no-transform: Caddy's `encode` leaves the stream alone and flushes
        // every event.
        res.setHeader('Cache-Control', 'no-cache, no-transform')
        res.setHeader('X-Accel-Buffering', 'no')
        res.flushHeaders()

        const abort = new AbortController()
        res.on('close', () => {
            if (!res.writableFinished) abort.abort()
        })
        const emit = (e: AiChatStreamEvent) => {
            if (res.writableEnded || res.destroyed) return
            res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
        }
        try {
            await turn.run(emit, abort.signal)
        } catch (error) {
            this.logger.error(
                'ИИ-ассистент: stream failed',
                error instanceof Error ? error.stack : String(error),
            )
            emit({ event: 'error', data: { message: 'Не удалось сохранить ответ — попробуйте ещё раз' } })
        } finally {
            res.end()
        }
    }
}
