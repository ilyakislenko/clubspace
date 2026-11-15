import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
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
import { CLUB_ADMINS, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CreateDiscountFeature,
    CreateDiscountInputSchema,
    CreateDiscountOutputSchema,
    type CreateDiscountFeatureResponse,
} from './create-discount.feature'
import {
    DeleteDiscountFeature,
    DeleteDiscountOutputSchema,
    type DeleteDiscountFeatureResponse,
} from './delete-discount.feature'
import {
    ListDiscountsFeature,
    ListDiscountsInputSchema,
    ListDiscountsOutputSchema,
    type ListDiscountsFeatureResponse,
} from './list-discounts.feature'
import {
    UpdateDiscountFeature,
    UpdateDiscountInputSchema,
    UpdateDiscountOutputSchema,
    type UpdateDiscountFeatureResponse,
} from './update-discount.feature'

class ListDiscountsQuery extends createZodDto(ListDiscountsInputSchema) {}
class ListDiscountsOutput extends createZodDto(ListDiscountsOutputSchema) {}
class CreateDiscountInput extends createZodDto(CreateDiscountInputSchema) {}
class DiscountOutput extends createZodDto(CreateDiscountOutputSchema) {}
class UpdateDiscountInput extends createZodDto(UpdateDiscountInputSchema) {}
class UpdateDiscountOutput extends createZodDto(UpdateDiscountOutputSchema) {}
class DeleteDiscountOutput extends createZodDto(DeleteDiscountOutputSchema) {}

// Club discounts (docs/design/2026-11-15-discounts.md §3.2): club money, like
// tariffs — owner and admins.
@Controller('workspaces/:workspaceId/discounts')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class DiscountsController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: ListDiscountsOutput })
    async listDiscounts(
        @Param('workspaceId') workspaceId: string,
        @Query() query: ListDiscountsQuery,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<ListDiscountsFeature, ListDiscountsFeatureResponse>(
            new ListDiscountsFeature(
                query,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post()
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: DiscountOutput })
    async createDiscount(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateDiscountInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<CreateDiscountFeature, CreateDiscountFeatureResponse>(
            new CreateDiscountFeature(
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Patch(':discountId')
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: UpdateDiscountOutput })
    async updateDiscount(
        @Param('workspaceId') workspaceId: string,
        @Param('discountId') discountId: string,
        @Body() body: UpdateDiscountInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<UpdateDiscountFeature, UpdateDiscountFeatureResponse>(
            new UpdateDiscountFeature(
                body,
                workspaceId,
                discountId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete(':discountId')
    @Roles(CLUB_ADMINS)
    @ZodResponse({ type: DeleteDiscountOutput })
    async deleteDiscount(
        @Param('workspaceId') workspaceId: string,
        @Param('discountId') discountId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<DeleteDiscountFeature, DeleteDiscountFeatureResponse>(
            new DeleteDiscountFeature(
                workspaceId,
                discountId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
