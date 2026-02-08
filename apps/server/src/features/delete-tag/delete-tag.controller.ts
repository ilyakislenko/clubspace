import { Controller, Delete, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import { AuthGuard } from '../../shared/guards/auth.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    DeleteTagFeature,
    DeleteTagFeatureOutputSchema,
    DeleteTagFeatureResponse,
} from './delete-tag.feature'

class DeleteTagOutput extends createZodDto(DeleteTagFeatureOutputSchema) {}

@Controller('workspaces/:workspaceId/tags')
@UseGuards(AuthGuard, WorkspaceMemberGuard)
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
