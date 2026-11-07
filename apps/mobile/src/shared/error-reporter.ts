// Framework-free core of crash reporting (wired up in crash-reporting.ts).
// Reports go to our own server (POST /client-errors), never to a third-party
// SDK: 152-ФЗ. Only technical fields — no user id, e-mail or device id.

export type ClientErrorPlatform = 'ios' | 'android' | 'web' | 'other';

export type ClientErrorReport = {
  message: string;
  stack?: string;
  platform: ClientErrorPlatform;
  appVersion: string;
  route?: string;
  fatal?: boolean;
};

// Server limits (report-client-error.feature.ts); longer text is cut, not
// rejected, so a giant stack still produces a report.
const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;
const MAX_ROUTE = 80;
// A crash loop must not send hundreds of reports, nor grow the dedupe set.
const MAX_REPORTS_PER_SESSION = 20;

export type ErrorReporterDeps = {
  send: (report: ClientErrorReport) => Promise<unknown>;
  platform: ClientErrorPlatform;
  appVersion: string;
  getRoute?: () => string | undefined;
};

const describe = (error: unknown): { message: string; stack?: string } => {
  if (error instanceof Error) {
    return {
      message: `${error.name}: ${error.message}`,
      stack: error.stack,
    };
  }
  if (typeof error === 'string') return { message: error };
  try {
    return { message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { message: String(error) };
  }
};

/** `report(error, { fatal })` — see `createErrorReporter`. */
export type ReportError = (
  error: unknown,
  options?: { fatal?: boolean },
) => Promise<void>;

// Returns `report(error, { fatal })`: never throws, sends each distinct
// message once per session (app launch). The returned promise settles when
// the send does and never rejects — offline or a server error → the report
// is simply dropped. Callers that don't need to wait just ignore it.
export const createErrorReporter = (deps: ErrorReporterDeps): ReportError => {
  const seen = new Set<string>();

  return (error, options = {}) => {
    try {
      const { message: raw, stack } = describe(error);
      const message = (raw.trim() || 'Unknown error').slice(0, MAX_MESSAGE);
      if (seen.has(message) || seen.size >= MAX_REPORTS_PER_SESSION) {
        return Promise.resolve();
      }
      seen.add(message);

      let route: string | undefined;
      try {
        route = deps.getRoute?.()?.slice(0, MAX_ROUTE) || undefined;
      } catch {
        route = undefined;
      }
      const report: ClientErrorReport = {
        message,
        stack: stack?.slice(0, MAX_STACK),
        platform: deps.platform,
        appVersion: deps.appVersion.slice(0, 40) || 'unknown',
        route,
        fatal: options.fatal,
      };
      return deps.send(report).then(
        () => undefined,
        () => undefined,
      );
    } catch {
      // A reporter that throws would turn one error into two.
      return Promise.resolve();
    }
  };
};

export type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

// How long a fatal error may delay the native crash to get its report out.
export const FATAL_REPORT_GRACE_MS = 1500;

// Wraps RN's previous global handler: report first, then hand over. In
// release a fatal error's `previous` kills the app, so it runs only once the
// report is sent or `graceMs` passed, whichever comes first. Non-fatal
// errors — and every error when `waitOnFatal` is off (dev: `previous` is the
// red box) — hand over at once.
export const reportThen =
  (
    previous: GlobalErrorHandler,
    report: ReportError,
    {
      waitOnFatal,
      graceMs = FATAL_REPORT_GRACE_MS,
    }: { waitOnFatal: boolean; graceMs?: number },
  ): GlobalErrorHandler =>
  (error, isFatal) => {
    const sent = report(error, { fatal: isFatal });
    if (!isFatal || !waitOnFatal) {
      previous(error, isFatal);
      return;
    }
    let handedOver = false;
    const handOver = () => {
      if (handedOver) return;
      handedOver = true;
      clearTimeout(timer);
      previous(error, isFatal);
    };
    const timer = setTimeout(handOver, graceMs);
    void sent.then(handOver);
  };
