import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { Roles, WORKSPACE_ADMINS } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ImportMembersFeature,
    ImportMembersInputSchema,
    ImportMembersOutputSchema,
    ImportMembersFeatureResponse,
} from './import-members.feature'

class ImportMembersBody extends createZodDto(ImportMembersInputSchema) {}
class ImportMembersOutput extends createZodDto(ImportMembersOutputSchema) {}

@Controller('workspaces/:workspaceId/members')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ImportMembersController {
    constructor(private bus: FeaturesBus) {}

    @Post('import')
    @Roles(WORKSPACE_ADMINS)
    @ZodResponse({ type: ImportMembersOutput })
    async import(
        @Param('workspaceId') workspaceId: string,
        @Body() body: ImportMembersBody,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ImportMembersFeature,
            ImportMembersFeatureResponse
        >(new ImportMembersFeature(body, workspaceId, user.userId))
    }
}
