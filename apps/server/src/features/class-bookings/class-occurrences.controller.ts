import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseUUIDPipe,
    Post,
    Put,
    UseGuards,
} from '@nestjs/common'
import { FeaturesBus } from '@shelfjs/features'
import { createZodDto, ZodResponse } from 'nestjs-zod'

import {
    CurrentUser,
    type CurrentUserPayload,
} from '../../shared/decorators/current-user.decorator'
import {
    COACHING_ROLES,
    Roles,
    STAFF_ROLES,
} from '../../shared/decorators/roles.decorator'
import { AuthGuard } from '../../shared/guards/auth.guard'
import { RoleGuard } from '../../shared/guards/role.guard'
import { WorkspaceMemberGuard } from '../../shared/guards/workspace-member.guard'
import {
    AddClassBookingFeature,
    AddClassBookingInputSchema,
    AddClassBookingOutputSchema,
    type AddClassBookingFeatureResponse,
} from './add-class-booking.feature'
import {
    GetClassOccurrenceFeature,
    GetClassOccurrenceOutputSchema,
    type GetClassOccurrenceFeatureResponse,
} from './get-class-occurrence.feature'
import {
    RemoveClassBookingFeature,
    RemoveClassBookingOutputSchema,
    type RemoveClassBookingFeatureResponse,
} from './remove-class-booking.feature'
import {
    SetClassCapacityFeature,
    SetClassCapacityInputSchema,
    SetClassCapacityOutputSchema,
    type SetClassCapacityFeatureResponse,
} from './set-class-capacity.feature'

class ClassOccurrenceOutput extends createZodDto(GetClassOccurrenceOutputSchema) {}
class AddClassBookingInput extends createZodDto(AddClassBookingInputSchema) {}
class AddClassBookingOutput extends createZodDto(AddClassBookingOutputSchema) {}
class RemoveClassBookingOutput extends createZodDto(
    RemoveClassBookingOutputSchema,
) {}
class SetClassCapacityInput extends createZodDto(SetClassCapacityInputSchema) {}
class SetClassCapacityOutput extends createZodDto(SetClassCapacityOutputSchema) {}

// Staff side of «Запись на занятие»: the roster of one dated class (booked /
// waitlist / attended / cancels), adding a member over the capacity, taking
// one off, the capacity of the date. Cancelling the class is a schedule
// exception (group-schedule.controller), which releases the bookings.
@Controller('workspaces/:workspaceId/class-occurrences/:slotId/:sessionDate')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ClassOccurrencesController {
    constructor(private bus: FeaturesBus) {}

    @Get()
    @Roles(STAFF_ROLES)
    @ZodResponse({ type: ClassOccurrenceOutput })
    async getClassOccurrence(
        @Param('workspaceId') workspaceId: string,
        @Param('slotId', ParseUUIDPipe) slotId: string,
        @Param('sessionDate') sessionDate: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetClassOccurrenceFeature,
            GetClassOccurrenceFeatureResponse
        >(
            new GetClassOccurrenceFeature(
                { slotId, sessionDate },
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Post('bookings')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: AddClassBookingOutput })
    async addClassBooking(
        @Param('workspaceId') workspaceId: string,
        @Param('slotId', ParseUUIDPipe) slotId: string,
        @Param('sessionDate') sessionDate: string,
        @Body() body: AddClassBookingInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            AddClassBookingFeature,
            AddClassBookingFeatureResponse
        >(
            new AddClassBookingFeature(
                { slotId, sessionDate },
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Delete('bookings/:bookingId')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: RemoveClassBookingOutput })
    async removeClassBooking(
        @Param('workspaceId') workspaceId: string,
        @Param('slotId', ParseUUIDPipe) slotId: string,
        @Param('sessionDate') sessionDate: string,
        @Param('bookingId', ParseUUIDPipe) bookingId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            RemoveClassBookingFeature,
            RemoveClassBookingFeatureResponse
        >(
            new RemoveClassBookingFeature(
                { slotId, sessionDate },
                bookingId,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }

    @Put('capacity')
    @Roles(COACHING_ROLES)
    @ZodResponse({ type: SetClassCapacityOutput })
    async setClassCapacity(
        @Param('workspaceId') workspaceId: string,
        @Param('slotId', ParseUUIDPipe) slotId: string,
        @Param('sessionDate') sessionDate: string,
        @Body() body: SetClassCapacityInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            SetClassCapacityFeature,
            SetClassCapacityFeatureResponse
        >(
            new SetClassCapacityFeature(
                { slotId, sessionDate },
                body,
                workspaceId,
                user.userId,
                user.role?.name ?? null,
                user.isSuperAdmin,
            ),
        )
    }
}
