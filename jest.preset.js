const nxPreset = require('@nx/jest/preset').default;

// Jest workers on Node 24 die now and then with SIGSEGV, each time in a
// different suite that passes when rerun alone. It is a V8 13.6 bug, not ours:
// Sparkplug's BaselineOutOfLinePrologue pushes a stale register into an
// internal frame and the mark-compact GC reads it as a pointer (macOS crash
// reports: ClearStaleLeftTrimmedPointerVisitor::VisitRootPointers <-
// InternalFrame::Iterate). Fixed by V8 0b94a9fd23ba, backported to v24.x in
// https://github.com/nodejs/node/pull/65753; tracking issue
// https://github.com/nodejs/node/issues/62393. Turning Sparkplug off avoids the
// code path, and its cost is within run-to-run noise for these suites.
//
// Node refuses --no-sparkplug in NODE_OPTIONS. jest-worker forks every child
// with the parent's process.execArgv, and this preset is loaded in the parent
// before any worker starts, so adding the flag here reaches every worker of
// every project. A spec file run in-band (a single file) stays in the parent
// and is not covered; full runs are where the crash shows up.
// Drop this once the repo is on a Node release that contains the fix.
if (!process.execArgv.includes('--no-sparkplug')) {
  process.execArgv.push('--no-sparkplug');
}

module.exports = {
  ...nxPreset,
  // Jest's default is one worker per core minus one: 13 per project on a
  // 14-core Mac, each worker around 1 GB RSS, several projects and worktrees
  // at once — the machine ran out of RAM. The full server suite took 86 s on
  // four workers (peak ~2.8 GB for all of them) against 83–144 s on the
  // default, measured on the same loaded machine.
  maxWorkers: 4,
  // jest-worker checks a worker's V8 heap after every test file and replaces
  // the process once it is above this, so a worker's footprint is bounded by
  // one file instead of growing with every file it has run.
  workerIdleMemoryLimit: '1GB',
};
