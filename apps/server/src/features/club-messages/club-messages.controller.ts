import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    ParseUUIDPipe,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
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
    CancelClubMessageFeature,
    type CancelClubMessageFeatureResponse,
    CancelClubMessageOutputSchema,
} from './cancel-club-message.feature'
import {
    GetClubMessageFeature,
    type GetClubMessageFeatureResponse,
    GetClubMessageOutputSchema,
} from './get-club-message.feature'
import {
    GetMyClubMessageFeature,
    type GetMyClubMessageFeatureResponse,
    GetMyClubMessageOutputSchema,
} from './get-my-club-message.feature'
import {
    ListClubMessageRecipientsFeature,
    type ListClubMessageRecipientsFeatureResponse,
    ListClubMessageRecipientsInputSchema,
    ListClubMessageRecipientsOutputSchema,
} from './list-club-message-recipients.feature'
import {
    ListClubMessagesFeature,
    type ListClubMessagesFeatureResponse,
    ListClubMessagesInputSchema,
    ListClubMessagesOutputSchema,
} from './list-club-messages.feature'
import {
    ListMyClubMessagesFeature,
    type ListMyClubMessagesFeatureResponse,
    ListMyClubMessagesInputSchema,
    ListMyClubMessagesOutputSchema,
} from './list-my-club-messages.feature'
import {
    MarkClubMessageReadFeature,
    type MarkClubMessageReadFeatureResponse,
    MarkClubMessageReadOutputSchema,
} from './mark-club-message-read.feature'
import {
    PreviewClubMessageFeature,
    type PreviewClubMessageFeatureResponse,
    PreviewClubMessageInputSchema,
    PreviewClubMessageOutputSchema,
} from './preview-club-message.feature'
import {
    SendClubMessageFeature,
    type SendClubMessageFeatureResponse,
    SendClubMessageInputSchema,
    SendClubMessageOutputSchema,
} from './send-club-message.feature'

class PreviewClubMessageInput extends createZodDto(PreviewClubMessageInputSchema) {}
class PreviewClubMessageOutput extends createZodDto(PreviewClubMessageOutputSchema) {}
class SendClubMessageInput extends createZodDto(SendClubMessageInputSchema) {}
class ClubMessageOutput extends createZodDto(SendClubMessageOutputSchema) {}
class ListClubMessagesQuery extends createZodDto(ListClubMessagesInputSchema) {}
class ListClubMessagesOutput extends createZodDto(ListClubMessagesOutputSchema) {}
class GetClubMessageOutput extends createZodDto(GetClubMessageOutputSchema) {}
class ListClubMessageRecipientsQuery extends createZodDto(ListClubMessageRecipientsInputSchema) {}
class ListClubMessageRecipientsOutput extends createZodDto(ListClubMessageRecipientsOutputSchema) {}
class CancelClubMessageOutput extends createZodDto(CancelClubMessageOutputSchema) {}
class ListMyClubMessagesQuery extends createZodDto(ListMyClubMessagesInputSchema) {}
class ListMyClubMessagesOutput extends createZodDto(ListMyClubMessagesOutputSchema) {}
class MyClubMessageOutput extends createZodDto(GetMyClubMessageOutputSchema) {}
class MarkClubMessageReadOutput extends createZodDto(MarkClubMessageReadOutputSchema) {}

// «Ученики → Сообщения» (docs/design/2026-11-26-broadcast-and-direct-messages.md
// §4.2). Every coach may write to students in their scope (resolveCoachScope);
// «Продлить», «Не оплатили» and «служебное» are checked inside
// (assertSportLead), as «assign subscription» does.
@Controller('workspaces/:workspaceId/messages')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ClubMessagesController {
    constructor(private bus: FeaturesBus) {}

    @Post('preview')
    @Roles(COACHING_ROLES)
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: PreviewClubMessageOutput })
    async previewClubMessage(
        @Param('workspaceId') workspaceId: string,
        @Body() body: PreviewClubMessageInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<PreviewClubMessageFeature, PreviewClubMessageFeatureResponse>(
            new PreviewClubMessageFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post()
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: ClubMessageOutput })
    async sendClubMessage(
        @Param('workspaceId') workspaceId: string,
        @Body() body: SendClubMessageInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<SendClubMessageFeature, SendClubMessageFeatureResponse>(
            new SendClubMessageFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get()
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: ListClubMessagesOutput })
    async listClubMessages(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListClubMessagesQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<ListClubMessagesFeature, ListClubMessagesFeatureResponse>(
            new ListClubMessagesFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get(':messageId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: GetClubMessageOutput })
    async getClubMessage(
        @Param('workspaceId') workspaceId: string,
        @Param('messageId', ParseUUIDPipe) messageId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<GetClubMessageFeature, GetClubMessageFeatureResponse>(
            new GetClubMessageFeature(
                workspaceId,
                messageId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Get(':messageId/recipients')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: ListClubMessageRecipientsOutput })
    async listClubMessageRecipients(
        @Param('workspaceId') workspaceId: string,
        @Param('messageId', ParseUUIDPipe) messageId: string,
        @Query() query: ListClubMessageRecipientsQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListClubMessageRecipientsFeature,
            ListClubMessageRecipientsFeatureResponse
        >(
            new ListClubMessageRecipientsFeature(
                query,
                workspaceId,
                messageId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post(':messageId/cancel')
    @Roles(COACHING_ROLES)
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: CancelClubMessageOutput })
    async cancelClubMessage(
        @Param('workspaceId') workspaceId: string,
        @Param('messageId', ParseUUIDPipe) messageId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<CancelClubMessageFeature, CancelClubMessageFeatureResponse>(
            new CancelClubMessageFeature(
                workspaceId,
                messageId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}

// The member's «Сообщения клуба»: any member of the club, a guardian acting
// for a child (X-Act-As) reads and opens the child's.
@Controller('workspaces/:workspaceId/me/messages')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class MyClubMessagesController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @ZodResponse({ type: ListMyClubMessagesOutput })
    async listMyClubMessages(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListMyClubMessagesQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<ListMyClubMessagesFeature, ListMyClubMessagesFeatureResponse>(
            new ListMyClubMessagesFeature(query, workspaceId, user.userId),
        )
    }

    @Get(':messageId')
    @ZodResponse({ type: MyClubMessageOutput })
    async getMyClubMessage(
        @Param('workspaceId') workspaceId: string,
        @Param('messageId', ParseUUIDPipe) messageId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<GetMyClubMessageFeature, GetMyClubMessageFeatureResponse>(
            new GetMyClubMessageFeature(workspaceId, messageId, user.userId),
        )
    }

    @Post(':messageId/read')
    @HttpCode(HttpStatus.OK)
    @ZodResponse({ type: MarkClubMessageReadOutput })
    async markClubMessageRead(
        @Param('workspaceId') workspaceId: string,
        @Param('messageId', ParseUUIDPipe) messageId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<MarkClubMessageReadFeature, MarkClubMessageReadFeatureResponse>(
            new MarkClubMessageReadFeature(workspaceId, messageId, user.userId),
        )
    }
}
