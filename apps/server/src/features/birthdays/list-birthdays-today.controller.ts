import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import { Roles, STAFF_ROLES } from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    ListBirthdaysTodayFeature,
    ListBirthdaysTodayOutputSchema,
    type ListBirthdaysTodayFeatureResponse,
} from './list-birthdays-today.feature'

class ListBirthdaysTodayOutput extends createZodDto(
    ListBirthdaysTodayOutputSchema,
) {}

// «Дни рождения сегодня» on «Сегодня» (admin) and Home (coach app).
@Controller('workspaces/:workspaceId/birthdays')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ListBirthdaysTodayController {
    constructor(private bus: FeaturesBus) {}

    @Get('today')
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: ListBirthdaysTodayOutput })
    async listBirthdaysToday(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            ListBirthdaysTodayFeature,
            ListBirthdaysTodayFeatureResponse
        >(
            new ListBirthdaysTodayFeature(
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
