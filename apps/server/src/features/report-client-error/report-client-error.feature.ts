import { z } from 'zod';

// POST /client-errors — a crash or unhandled error from the mobile app (or
// another client without its own Sentry SDK). 152-ФЗ: reports stay on our
// server, so the payload carries only technical fields — no user id, e-mail,
// phone or device identifier. Anonymous on purpose: a crash before sign-in
// must still be visible.
export const CLIENT_ERROR_PLATFORMS = [
  'ios',
  'android',
  'web',
  'other',
] as const;

export const ReportClientErrorInputSchema = z.strictObject({
  message: z.string().trim().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  platform: z.enum(CLIENT_ERROR_PLATFORMS),
  appVersion: z.string().trim().min(1).max(40),
  // Screen the user was on (navigation route name), not a URL with ids.
  route: z.string().trim().max(80).optional(),
  // A render crash caught by the error boundary vs. a global JS error.
  fatal: z.boolean().optional(),
});
export const ReportClientErrorOutputSchema = z.object({
  status: z.literal('received'),
});
export class ReportClientErrorFeature {
  constructor(readonly payload: z.infer<typeof ReportClientErrorInputSchema>) {}
}
export type ReportClientErrorFeatureResponse = z.infer<
  typeof ReportClientErrorOutputSchema
>;
