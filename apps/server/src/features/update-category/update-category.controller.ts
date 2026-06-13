import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    UpdateCategoryFeature,
    UpdateCategoryFeatureInputSchema,
    UpdateCategoryFeatureOutputSchema,
    UpdateCategoryFeatureResponse,
} from './update-category.feature'

class UpdateCategoryInput extends createZodDto(
    UpdateCategoryFeatureInputSchema,
) {}

class UpdateCategoryOutput extends createZodDto(
    UpdateCategoryFeatureOutputSchema,
) {}

@Controller('workspaces/:workspaceId/categories')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class UpdateCategoryController {
    constructor(private bus: FeaturesBus) {}

    @Patch(':categoryId')
    @ZodResponse({ type: UpdateCategoryOutput })
    async updateCategory(
        @Param('workspaceId') workspaceId: string,
        @Param('categoryId') categoryId: string,
        @Body() input: UpdateCategoryInput,
    ) {
        return await this.bus.execute<
            UpdateCategoryFeature,
            UpdateCategoryFeatureResponse
        >(new UpdateCategoryFeature(input, workspaceId, categoryId))
    }
}
