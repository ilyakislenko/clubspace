import {
  createErrorReporter,
  reportThen,
  type ClientErrorReport,
} from './error-reporter';

const setup = (send = jest.fn(async (_r: ClientErrorReport) => undefined)) => {
  const report = createErrorReporter({
    send,
    platform: 'ios',
    appVersion: '1.4.0',
    getRoute: () => 'Schedule',
  });
  return { report, send };
};

describe('createErrorReporter', () => {
  it('sends one report per distinct message within a session', () => {
    const { report, send } = setup();
    report(new TypeError('x is undefined'));
    report(new TypeError('x is undefined'));
    report(new Error('other'));

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toMatchObject({
      message: 'TypeError: x is undefined',
      platform: 'ios',
      appVersion: '1.4.0',
      route: 'Schedule',
    });
    expect(send.mock.calls[1][0].message).toBe('Error: other');
  });

  it('caps a crash loop of distinct messages', () => {
    const { report, send } = setup();
    for (let i = 0; i < 50; i++) report(new Error(`e${i}`));
    expect(send).toHaveBeenCalledTimes(20);
  });

  it('cuts oversize text to the server limits', () => {
    const { report, send } = setup();
    const error = new Error('m'.repeat(5000));
    error.stack = 's'.repeat(20000);
    report(error, { fatal: true });
    const sent = send.mock.calls[0][0];
    expect(sent.message).toHaveLength(2000);
    expect(sent.stack).toHaveLength(8000);
    expect(sent.fatal).toBe(true);
  });

  it('never throws: a failing or throwing transport is swallowed', async () => {
    const rejecting = setup(
      jest.fn(async () => {
        throw new Error('offline');
      }),
    );
    expect(() => rejecting.report(new Error('a'))).not.toThrow();

    const throwing = setup(
      jest.fn(() => {
        throw new Error('sync');
      }),
    );
    expect(() => throwing.report(new Error('b'))).not.toThrow();
    await Promise.resolve();
  });

  it('describes non-Error values', () => {
    const { report, send } = setup();
    report('plain string');
    report({ code: 42 });
    expect(send.mock.calls.map((c) => c[0].message)).toEqual([
      'plain string',
      '{"code":42}',
    ]);
  });

  it('resolves once the send settles, even when it fails', async () => {
    const ok = setup();
    await expect(ok.report(new Error('a'))).resolves.toBeUndefined();
    const failing = setup(
      jest.fn(async () => {
        throw new Error('offline');
      }),
    );
    await expect(failing.report(new Error('b'))).resolves.toBeUndefined();
    // A duplicate is not sent and resolves at once.
    await expect(ok.report(new Error('a'))).resolves.toBeUndefined();
  });
});

describe('reportThen', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // A send that stays pending until the test resolves it.
  const pendingReport = () => {
    let finish: () => void = () => undefined;
    const report = jest.fn(
      (_error: unknown, _options?: { fatal?: boolean }) =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    return { report, finish: () => finish() };
  };

  it('hands a fatal release error over only after the report is sent', async () => {
    const previous = jest.fn();
    const { report, finish } = pendingReport();
    const error = new Error('boom');

    reportThen(previous, report, { waitOnFatal: true })(error, true);
    expect(report).toHaveBeenCalledWith(error, { fatal: true });
    expect(previous).not.toHaveBeenCalled();

    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(previous).toHaveBeenCalledTimes(1);
    expect(previous).toHaveBeenCalledWith(error, true);

    // The grace timer is cleared: no second hand-over.
    jest.advanceTimersByTime(5000);
    expect(previous).toHaveBeenCalledTimes(1);
  });

  it('hands a fatal error over after the grace period when the send hangs', () => {
    const previous = jest.fn();
    const { report } = pendingReport();

    reportThen(previous, report, { waitOnFatal: true })(new Error('x'), true);
    jest.advanceTimersByTime(1499);
    expect(previous).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(previous).toHaveBeenCalledTimes(1);
  });

  it('hands non-fatal errors, and every error in dev, over at once', () => {
    const previous = jest.fn();
    const { report } = pendingReport();

    reportThen(previous, report, { waitOnFatal: true })(new Error('a'), false);
    expect(previous).toHaveBeenCalledTimes(1);

    reportThen(previous, report, { waitOnFatal: false })(new Error('b'), true);
    expect(previous).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledTimes(2);
  });
});
