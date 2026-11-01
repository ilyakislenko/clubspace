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
    BookClassFeature,
    BookClassInputSchema,
    BookClassOutputSchema,
    type BookClassFeatureResponse,
} from './book-class.feature'
import {
    CancelClassBookingFeature,
    CancelClassBookingOutputSchema,
    type CancelClassBookingFeatureResponse,
} from './cancel-class-booking.feature'
import {
    GetMyClassBookingsFeature,
    GetMyClassBookingsOutputSchema,
    type GetMyClassBookingsFeatureResponse,
} from './get-my-class-bookings.feature'

class BookClassInput extends createZodDto(BookClassInputSchema) {}
class ClassBookingOutput extends createZodDto(BookClassOutputSchema) {}
class CancelClassBookingOutput extends createZodDto(
    CancelClassBookingOutputSchema,
) {}
class MyClassBookingsOutput extends createZodDto(
    GetMyClassBookingsOutputSchema,
) {}

// Member actions on «Запись на занятие» classes: no @Roles, any member (a
// guardian acting for a child included). The service does the rules.
@Controller('workspaces/:workspaceId/class-bookings')
@UseGuards(AuthGuard, WorkspaceMemberGuard, RoleGuard)
export class ClassBookingsController {
    constructor(private bus: FeaturesBus) {}

    @Get('mine')
    @ZodResponse({ type: MyClassBookingsOutput })
    async getMyClassBookings(
        @Param('workspaceId') workspaceId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            GetMyClassBookingsFeature,
            GetMyClassBookingsFeatureResponse
        >(new GetMyClassBookingsFeature(workspaceId, user.userId))
    }

    @Post()
    @ZodResponse({ type: ClassBookingOutput })
    async bookClass(
        @Param('workspaceId') workspaceId: string,
        @Body() body: BookClassInput,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<BookClassFeature, BookClassFeatureResponse>(
            new BookClassFeature(
                body,
                workspaceId,
                user.userId,
                user.guardianId ?? user.userId,
            ),
        )
    }

    @Delete(':bookingId')
    @ZodResponse({ type: CancelClassBookingOutput })
    async cancelClassBooking(
        @Param('workspaceId') workspaceId: string,
        @Param('bookingId', ParseUUIDPipe) bookingId: string,
        @CurrentUser() user: CurrentUserPayload,
    ) {
        return await this.bus.execute<
            CancelClassBookingFeature,
            CancelClassBookingFeatureResponse
        >(new CancelClassBookingFeature(workspaceId, bookingId, user.userId))
    }
}
