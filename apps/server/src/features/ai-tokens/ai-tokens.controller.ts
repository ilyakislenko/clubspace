import {
    Body,
    Controller,
    Delete,
    Get,
    Headers,
    Ip,
    Param,
    ParseUUIDPipe,
    Post,
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
    AiTokenOutputSchema,
    CreateAiTokenFeature,
    type CreateAiTokenFeatureResponse,
    CreateAiTokenInputSchema,
    CreateAiTokenOutputSchema,
    ListAiTokensFeature,
    type ListAiTokensFeatureResponse,
    ListAiTokensOutputSchema,
    RevokeAiTokenFeature,
    type RevokeAiTokenFeatureResponse,
} from './ai-tokens.feature'

class CreateAiTokenInput extends createZodDto(CreateAiTokenInputSchema) {}
class CreateAiTokenOutput extends createZodDto(CreateAiTokenOutputSchema) {}
class ListAiTokensOutput extends createZodDto(ListAiTokensOutputSchema) {}
class AiTokenOutputDto extends createZodDto(AiTokenOutputSchema) {}

// «Интеграции → ИИ-ассистент». COACHING_ROLES so a руководитель направления
// reaches the handler; resolveAiAccess there refuses plain coaches.
@Controller('workspaces/:workspaceId/ai-tokens')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class AiTokensController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: ListAiTokensOutput })
    async listAiTokens(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<ListAiTokensFeature, ListAiTokensFeatureResponse>(
            new ListAiTokensFeature(workspaceId, user.userId),
        )
    }

    @Post()
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: CreateAiTokenOutput })
    async createAiToken(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateAiTokenInput,
        @CurrentUser() user: CurrentUserPayload,
        @Ip() ip: string | undefined,
        @Headers('user-agent') userAgent: string | undefined,
    ) {
        return this.bus.execute<CreateAiTokenFeature, CreateAiTokenFeatureResponse>(
            new CreateAiTokenFeature(
                body,
                workspaceId,
                user.userId,
                ip ?? null,
                userAgent ?? null,
            ),
        )
    }

    @Delete(':tokenId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: AiTokenOutputDto })
    async revokeAiToken(
        @Param('workspaceId') workspaceId: string,
        @Param('tokenId', ParseUUIDPipe) tokenId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<RevokeAiTokenFeature, RevokeAiTokenFeatureResponse>(
            new RevokeAiTokenFeature(workspaceId, tokenId, user.userId),
        )
    }
}
