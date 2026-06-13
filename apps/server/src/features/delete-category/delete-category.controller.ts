import { Controller, Delete, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    DeleteCategoryFeature,
    DeleteCategoryFeatureOutputSchema,
    DeleteCategoryFeatureResponse,
} from './delete-category.feature'

class DeleteCategoryOutput extends createZodDto(DeleteCategoryFeatureOutputSchema) {}

@Controller('workspaces/:workspaceId/categories')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class DeleteCategoryController {
    constructor(private bus: FeaturesBus) {}

    @Delete(':categoryId')
    @ZodResponse({ type: DeleteCategoryOutput })
    async deleteCategory(
        @Param('workspaceId') workspaceId: string,
        @Param('categoryId') categoryId: string,
    ) {
        return await this.bus.execute<
            DeleteCategoryFeature,
            DeleteCategoryFeatureResponse
        >(new DeleteCategoryFeature(workspaceId, categoryId))
    }
}
