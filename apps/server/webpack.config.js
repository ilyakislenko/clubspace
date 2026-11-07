const { join } = require('path');
const { composePlugins, withNx } = require('@nx/webpack');

// Workspace libs bundled into the server instead of required at runtime: the
// server image installs only its own package.json dependencies.
const BUNDLED_WORKSPACE_LIBS = {
  '@clubspace/sport-glossary': join(__dirname, '../../libs/sport-glossary/src/index.ts'),
};

module.exports = composePlugins(
  withNx({ target: 'node' }),
  (config) => {
    // libs/sport-glossary (shared with the video worker) is a workspace
    // package, so the node_modules externals would leave it a runtime
    // require; resolve it to its sources and keep it out of the externals.
    config.resolve = {
      ...config.resolve,
      alias: { ...(config.resolve?.alias ?? {}), ...BUNDLED_WORKSPACE_LIBS },
    };
    const externals = Array.isArray(config.externals)
      ? config.externals
      : config.externals
        ? [config.externals]
        : [];
    config.externals = externals.map((external) =>
      typeof external === 'function'
        ? (ctx, callback) =>
            ctx.request in BUNDLED_WORKSPACE_LIBS
              ? callback()
              : external(ctx, callback)
        : external,
    );
    return config;
  }
);
