import {
    Body,
    Controller,
    Delete,
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
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    CancelDropInFeature,
    CancelDropInOutputSchema,
    type CancelDropInFeatureResponse,
} from './cancel-drop-in.feature'
import {
    CreateDropInFeature,
    CreateDropInInputSchema,
    CreateDropInOutputSchema,
    type CreateDropInFeatureResponse,
} from './create-drop-in.feature'
import {
    GetMyDropInsFeature,
    GetMyDropInsOutputSchema,
    type GetMyDropInsFeatureResponse,
} from './get-my-drop-ins.feature'

class CreateDropInInput extends createZodDto(CreateDropInInputSchema) {}
class DropInBookingOutput extends createZodDto(CreateDropInOutputSchema) {}
class CancelDropInOutput extends createZodDto(CancelDropInOutputSchema) {}
class MyDropInsOutput extends createZodDto(GetMyDropInsOutputSchema) {}

// Member actions (book a class in another group): no @Roles, any active
// workspace member. The handlers do the eligibility checks.
@Controller('workspaces/:workspaceId/drop-ins')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class DropInsController {
    constructor(private bus: FeaturesBus) {}

    @Get('mine')
    @ZodResponse({ type: MyDropInsOutput })
    async getMyDropIns(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetMyDropInsFeature,
            GetMyDropInsFeatureResponse
        >(new GetMyDropInsFeature(workspaceId, user.userId))
    }

    @Post()
    @ZodResponse({ type: DropInBookingOutput })
    async createDropIn(
        @Param('workspaceId') workspaceId: string,
        @Body() body: CreateDropInInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CreateDropInFeature,
            CreateDropInFeatureResponse
        >(new CreateDropInFeature(body, workspaceId, user.userId))
    }

    @Delete(':bookingId')
    @ZodResponse({ type: CancelDropInOutput })
    async cancelDropIn(
        @Param('workspaceId') workspaceId: string,
        @Param('bookingId', ParseUUIDPipe) bookingId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CancelDropInFeature,
            CancelDropInFeatureResponse
        >(new CancelDropInFeature(workspaceId, bookingId, user.userId))
    }
}
