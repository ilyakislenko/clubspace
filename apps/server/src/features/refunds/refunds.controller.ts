import { Body, Controller, Delete, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { CLUB_ADMINS, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CreateRefundFeature,
    type CreateRefundFeatureResponse,
    CreateRefundInputSchema,
    CreateRefundOutputSchema,
} from './create-refund.feature'
import {
    DeleteRefundFeature,
    type DeleteRefundFeatureResponse,
    DeleteRefundOutputSchema,
} from './delete-refund.feature'

class CreateRefundInput extends createZodDto(CreateRefundInputSchema) {}
class CreateRefundOutput extends createZodDto(CreateRefundOutputSchema) {}
class DeleteRefundOutput extends createZodDto(DeleteRefundOutputSchema) {}

// Refunds (docs/design/2026-11-15-payments-journal.md §3.2): money, owner and
// admins only.
@Controller('workspaces/:workspaceId/refunds')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class RefundsController {
    constructor(private bus: FeaturesBus) {}

    @Post()
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: CreateRefundOutput })
    async createRefund(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateRefundInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<CreateRefundFeature, CreateRefundFeatureResponse>(
            new CreateRefundFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':refundId')
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: DeleteRefundOutput })
    async deleteRefund(
        @Param('workspaceId') workspaceId: string,
        @Param('refundId', ParseUUIDPipe) refundId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<DeleteRefundFeature, DeleteRefundFeatureResponse>(
            new DeleteRefundFeature(
                refundId,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
