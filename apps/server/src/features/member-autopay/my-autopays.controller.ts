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

import { AllowExpiredAccess } from '../../shared/decorators/allow-expired-access.decorator'
import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    AcceptMyAutopayTermsFeature,
    AcceptMyAutopayTermsInputSchema,
    type AcceptMyAutopayTermsFeatureResponse,
} from './accept-my-autopay-terms.feature'
import {
    CancelMyAutopayFeature,
    CancelMyAutopayOutputSchema,
    type CancelMyAutopayFeatureResponse,
} from './cancel-my-autopay.feature'
import {
    ListMyAutopaysFeature,
    ListMyAutopaysOutputSchema,
    type ListMyAutopaysFeatureResponse,
} from './list-my-autopays.feature'

class ListMyAutopaysOutput extends createZodDto(ListMyAutopaysOutputSchema) {}
class MyAutopayOutput extends createZodDto(CancelMyAutopayOutputSchema) {}
class AcceptMyAutopayTermsInput extends createZodDto(AcceptMyAutopayTermsInputSchema) {}

// The member's own autopay (docs/design/2026-11-15-member-autopay.md §3.5) —
// no @Roles, no section switch. The list and the cancel stay open after
// access ran out: a refusal must always be possible (376-ФЗ).
@Controller('workspaces/:workspaceId/me/autopays')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class MyAutopaysController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @AllowExpiredAccess()
    @ZodResponse({ type: ListMyAutopaysOutput })
    async listMyAutopays(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<ListMyAutopaysFeature, ListMyAutopaysFeatureResponse>(
            new ListMyAutopaysFeature(workspaceId, user.userId),
        )
    }

    @Post(':autopayId/cancel')
    @AllowExpiredAccess()
    @ZodResponse({ type: MyAutopayOutput })
    async cancelMyAutopay(
        @Param('workspaceId') workspaceId: string,
        @Param('autopayId', ParseUUIDPipe) autopayId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<CancelMyAutopayFeature, CancelMyAutopayFeatureResponse>(
            new CancelMyAutopayFeature(workspaceId, autopayId, user.userId),
        )
    }

    @Post(':autopayId/accept-terms')
    @ZodResponse({ type: MyAutopayOutput })
    async acceptMyAutopayTerms(
        @Param('workspaceId') workspaceId: string,
        @Param('autopayId', ParseUUIDPipe) autopayId: string,
        @Body() body: AcceptMyAutopayTermsInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return this.bus.execute<
            AcceptMyAutopayTermsFeature,
            AcceptMyAutopayTermsFeatureResponse
        >(new AcceptMyAutopayTermsFeature(body, workspaceId, autopayId, user.userId))
    }
}
