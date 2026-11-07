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

// Returns `report(error, { fatal })`: fire-and-forget, never throws, sends
// each distinct message once per session (app launch). Offline or a server
// error → the report is simply dropped.
export const createErrorReporter = (deps: ErrorReporterDeps) => {
  const seen = new Set<string>();

  return (error: unknown, options: { fatal?: boolean } = {}): void => {
    try {
      const { message: raw, stack } = describe(error);
      const message = (raw.trim() || 'Unknown error').slice(0, MAX_MESSAGE);
      if (seen.has(message) || seen.size >= MAX_REPORTS_PER_SESSION) return;
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
      deps.send(report).catch(() => undefined);
    } catch {
      // A reporter that throws would turn one error into two.
    }
  };
};
