import { Controller, Delete, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { COACHING_ROLES, Roles } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    DeleteTagFeature,
    DeleteTagFeatureOutputSchema,
    DeleteTagFeatureResponse,
} from './delete-tag.feature'

class DeleteTagOutput extends createZodDto(DeleteTagFeatureOutputSchema) {}

@Controller('workspaces/:workspaceId/tags')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
@Roles(COACHING_ROLES)
export class DeleteTagController {
    constructor(private bus: FeaturesBus) {}

    @Delete(':tagId')
    @ZodResponse({ type: DeleteTagOutput })
    async deleteTag(
        @Param('workspaceId') workspaceId: string,
        @Param('tagId') tagId: string,
    ) {
        return await this.bus.execute<DeleteTagFeature, DeleteTagFeatureResponse>(
            new DeleteTagFeature(workspaceId, tagId),
        )
    }
}
