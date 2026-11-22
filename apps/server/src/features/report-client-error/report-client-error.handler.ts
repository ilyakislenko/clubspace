import { Logger } from '@nestjs/common';
import { Feature, IFeatureHandler } from '@shelfjs/features';

import { captureClientError } from '../../app/sentry';
import {
  ReportClientErrorFeature,
  ReportClientErrorFeatureResponse,
} from './report-client-error.feature';

// Logs the report and forwards it to Sentry when the server has a DSN (the
// event goes through the same scrubber as server errors). Never fails the
// client: a reporter that errors would only produce more reports.
@Feature(ReportClientErrorFeature)
export class ReportClientErrorHandler
  implements
    IFeatureHandler<ReportClientErrorFeature, ReportClientErrorFeatureResponse>
{
  private readonly logger = new Logger('ClientError');

  async execute({ payload }: ReportClientErrorFeature) {
    const where = payload.route ? ` @${payload.route}` : '';
    this.logger.warn(
      `[${payload.platform} ${payload.appVersion}${where}]${
        payload.fatal ? ' fatal' : ''
      } ${payload.message}`,
    );
    captureClientError(payload);
    return { status: 'received' as const };
  }
}
