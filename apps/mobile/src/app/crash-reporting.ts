import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { environment } from '../shared/env';
import {
  createErrorReporter,
  type ClientErrorPlatform,
  type ClientErrorReport,
} from '../shared/error-reporter';
import { navigationRef } from './navigation';

// Crash reporting without a native SDK: errors go to our server
// (POST /client-errors), which logs them and forwards to its Sentry.
// Plain fetch, not getApiClient(): no auth/refresh interceptors that could
// themselves fail, and the report is anonymous by design.

const platform: ClientErrorPlatform =
  Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
    ? Platform.OS
    : 'other';

const appVersion =
  Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? 'unknown';

const send = async (report: ClientErrorReport) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    await fetch(`${environment.apiBaseUrl.replace(/\/+$/, '')}/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

export const reportError = createErrorReporter({
  send,
  platform,
  appVersion,
  getRoute: () =>
    navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined,
});

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;
type RnErrorUtils = {
  getGlobalHandler: () => GlobalErrorHandler;
  setGlobalHandler: (handler: GlobalErrorHandler) => void;
};
type HermesRejectionTracker = {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, error: unknown) => void;
    onHandled?: (id: number) => void;
  }) => void;
};

let installed = false;

// Global JS errors and unhandled promise rejections. Installed once, before
// the first render; the previous handler keeps running (RN's red box in dev,
// the native crash in release).
export const installCrashReporting = () => {
  if (installed) return;
  installed = true;
  const g = globalThis as {
    ErrorUtils?: RnErrorUtils;
    HermesInternal?: HermesRejectionTracker;
    addEventListener?: (
      type: string,
      listener: (event: unknown) => void,
    ) => void;
  };

  if (Platform.OS === 'web') {
    g.addEventListener?.('error', (event) => {
      const e = event as { error?: unknown; message?: string };
      reportError(e.error ?? e.message);
    });
    g.addEventListener?.('unhandledrejection', (event) => {
      reportError((event as { reason?: unknown }).reason);
    });
    return;
  }

  const errorUtils = g.ErrorUtils;
  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      reportError(error, { fatal: isFatal });
      previous(error, isFatal);
    });
  }

  // In dev RN's own tracker feeds LogBox; replacing it there would hide the
  // warnings, so only release builds hook rejections.
  if (!__DEV__) {
    g.HermesInternal?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (_id, error) => reportError(error),
    });
  }
};
