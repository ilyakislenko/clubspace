import {
    Body,
    Controller,
    Get,
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
import { Roles, SPORT_LEADS } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CancelMemberAutopayFeature,
    CancelMemberAutopayInputSchema,
    CancelMemberAutopayOutputSchema,
    type CancelMemberAutopayFeatureResponse,
} from './cancel-member-autopay.feature'
import {
    ListMemberAutopaysFeature,
    ListMemberAutopaysOutputSchema,
    type ListMemberAutopaysFeatureResponse,
} from './list-member-autopays.feature'

class ListMemberAutopaysOutput extends createZodDto(ListMemberAutopaysOutputSchema) {}
class MemberAutopayOutput extends createZodDto(CancelMemberAutopayOutputSchema) {}
class CancelMemberAutopayInput extends createZodDto(CancelMemberAutopayInputSchema) {}

// Staff side of member autopay (docs/design/2026-11-15-member-autopay.md
// §3.5): the member card's block and a cancel at the member's request. Sport
// leads; amounts and the card are stripped in the handler for head coaches.
@Controller('workspaces/:workspaceId')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class MemberAutopaysController {
    constructor(private bus: FeaturesBus) {}

    @Get('members/:userId/autopays')
    @Roles(SPORT_LEADS)
    @ZodResponse({ type: ListMemberAutopaysOutput })
    async listMemberAutopays(
        @Param('workspaceId') workspaceId: string,
        @Param('userId', ParseUUIDPipe) userId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<ListMemberAutopaysFeature, ListMemberAutopaysFeatureResponse>(
            new ListMemberAutopaysFeature(
                workspaceId,
                userId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('autopays/:autopayId/cancel')
    @Roles(SPORT_LEADS)
    @ZodResponse({ type: MemberAutopayOutput })
    async cancelMemberAutopay(
        @Param('workspaceId') workspaceId: string,
        @Param('autopayId', ParseUUIDPipe) autopayId: string,
        @Body() body: CancelMemberAutopayInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<CancelMemberAutopayFeature, CancelMemberAutopayFeatureResponse>(
            new CancelMemberAutopayFeature(
                body,
                workspaceId,
                autopayId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
