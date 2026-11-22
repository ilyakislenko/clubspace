import { captureClientError } from '../../app/sentry';
import {
  ReportClientErrorInputSchema,
  ReportClientErrorFeature,
} from './report-client-error.feature';
import { ReportClientErrorHandler } from './report-client-error.handler';

jest.mock('../../app/sentry', () => ({ captureClientError: jest.fn() }));

const VALID = {
  message: 'TypeError: undefined is not an object',
  stack: 'at render (App.tsx:10)',
  platform: 'ios' as const,
  appVersion: '1.4.0',
  route: 'Schedule',
  fatal: true,
};

describe('ReportClientErrorHandler', () => {
  beforeEach(() => jest.mocked(captureClientError).mockClear());

  it('logs the report and forwards it to Sentry', async () => {
    const handler = new ReportClientErrorHandler();
    const warn = jest
      .spyOn(
        (handler as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);

    await expect(
      handler.execute(new ReportClientErrorFeature(VALID)),
    ).resolves.toEqual({ status: 'received' });

    expect(warn.mock.calls[0][0]).toContain('[ios 1.4.0 @Schedule] fatal');
    expect(warn.mock.calls[0][0]).toContain(VALID.message);
    expect(captureClientError).toHaveBeenCalledWith(VALID);
  });

  it('accepts an anonymous minimal report (no user fields at all)', () => {
    const parsed = ReportClientErrorInputSchema.safeParse({
      message: 'boom',
      platform: 'android',
      appVersion: '1.0.0',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects oversize message and stack', () => {
    expect(
      ReportClientErrorInputSchema.safeParse({
        ...VALID,
        message: 'x'.repeat(2001),
      }).success,
    ).toBe(false);
    expect(
      ReportClientErrorInputSchema.safeParse({
        ...VALID,
        stack: 'x'.repeat(8001),
      }).success,
    ).toBe(false);
  });

  it('rejects unknown fields so no PII can ride along', () => {
    expect(
      ReportClientErrorInputSchema.safeParse({ ...VALID, email: 'a@b.ru' })
        .success,
    ).toBe(false);
  });
});
