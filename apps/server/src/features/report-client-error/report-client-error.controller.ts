import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FeaturesBus } from '@shelfjs/features';
import { createZodDto, ZodResponse } from 'nestjs-zod';

import { trackByClientIp } from '../../shared/guards/club-throttler.guard';
import {
  ReportClientErrorFeature,
  ReportClientErrorFeatureResponse,
  ReportClientErrorInputSchema,
  ReportClientErrorOutputSchema,
} from './report-client-error.feature';

class ReportClientErrorInputDto extends createZodDto(
  ReportClientErrorInputSchema,
) {}
class ReportClientErrorOutput extends createZodDto(
  ReportClientErrorOutputSchema,
) {}

// Unauthenticated (a crash can happen before sign-in), so per IP. The app
// dedupes per session; a crash loop or a script hits the wall at 30 a minute.
export const CLIENT_ERROR_THROTTLE = {
  default: { ttl: 60_000, limit: 30, getTracker: trackByClientIp },
};

@Controller('client-errors')
@ApiTags('Public')
export class ReportClientErrorController {
  constructor(private bus: FeaturesBus) {}

  @Post()
  @HttpCode(202)
  @Throttle(CLIENT_ERROR_THROTTLE)
  @ZodResponse({ type: ReportClientErrorOutput, status: 202 })
  async reportClientError(@Body() body: ReportClientErrorInputDto) {
    return await this.bus.execute<
      ReportClientErrorFeature,
      ReportClientErrorFeatureResponse
    >(new ReportClientErrorFeature(body));
  }
}
