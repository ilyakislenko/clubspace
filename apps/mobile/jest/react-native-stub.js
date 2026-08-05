// Minimal stand-in for `react-native` so helper specs can load.
//
// The real package ships Flow-typed ESM (`import typeof * as ... from
// './index.js.flow'`) which the lean jest setup here does not transform. That
// broke workspaces-cache.spec.ts the moment shared/platform.ts started
// importing `Platform` — the whole suite failed to load, and since nothing
// gated on mobile tests it stayed broken and invisible.
//
// Anything NOT stubbed here throws by name instead of returning undefined. A
// permissive stub is how you get a spec that passes against a mock while the
// app crashes on the same code path.
const stubbed = {
    // Specs run as a native build by default. A spec that needs the web
    // behaviour of shared/platform.ts should jest.mock('react-native') itself
    // with OS: 'web' — those flags are read once at module load, so it has to
    // happen before the import.
    Platform: {
        OS: 'ios',
        select: (spec) =>
            'ios' in spec ? spec.ios : 'native' in spec ? spec.native : spec.default,
    },
}

module.exports = new Proxy(stubbed, {
    get(target, prop) {
        if (prop in target) return target[prop]
        // Let jest/node's own interop probes through untouched.
        if (typeof prop === 'symbol' || prop === '__esModule') return undefined
        throw new Error(
            `react-native.${String(prop)} is not stubbed. Add it to ` +
                `apps/mobile/jest/react-native-stub.js if a helper spec ` +
                `legitimately needs it, or mock it in the spec itself.`,
        )
    },
})
