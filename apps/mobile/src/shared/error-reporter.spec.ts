import { createErrorReporter, type ClientErrorReport } from './error-reporter';

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
});
