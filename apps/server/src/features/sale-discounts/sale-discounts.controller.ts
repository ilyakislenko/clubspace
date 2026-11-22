import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
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
    ListSaleDiscountsFeature,
    ListSaleDiscountsInputSchema,
    ListSaleDiscountsOutputSchema,
    type ListSaleDiscountsFeatureResponse,
} from './list-sale-discounts.feature'

class ListSaleDiscountsQuery extends createZodDto(ListSaleDiscountsInputSchema) {}
class ListSaleDiscountsOutput extends createZodDto(ListSaleDiscountsOutputSchema) {}

// Selling stays with every coaching role (Q1); the handler scopes the member.
@Controller('workspaces/:workspaceId/members/:userId')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class SaleDiscountsController {
    constructor(private bus: FeaturesBus) {}

    @Get('sale-discounts')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: ListSaleDiscountsOutput })
    async listSaleDiscounts(
        @Param('workspaceId') workspaceId: string,
        @Param('userId') userId: string,
        @Query() query: ListSaleDiscountsQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<ListSaleDiscountsFeature, ListSaleDiscountsFeatureResponse>(
            new ListSaleDiscountsFeature(
                query,
                workspaceId,
                userId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
