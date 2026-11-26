const { join } = require('path');
const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');

// One config, three bundles: the API itself and two headless tools that boot
// the same Nest modules (OpenAPI generation, demo reset). `--env bundle=<name>`
// picks one; the inferred `build` target passes nothing and gets the server.
const BUNDLES = {
  server: {
    main: './src/app/main.ts',
    outputPath: '../../dist/apps/server',
    generatePackageJson: true,
  },
  openapi: {
    main: './src/generate-open-api.tool.ts',
    outputPath: '../../dist/apps/server-openapi',
  },
  demo: {
    main: './src/demo-reset.tool.ts',
    outputPath: '../../dist/apps/server-demo',
  },
};

// Workspace libs bundled into the server instead of required at runtime: the
// server image installs only its own package.json dependencies.
const BUNDLED_WORKSPACE_LIBS = {
  '@clubspace/sport-glossary': join(__dirname, '../../libs/sport-glossary/src/index.ts'),
};

// libs/sport-glossary (shared with the video worker) is a workspace package,
// so the node_modules externals NxAppWebpackPlugin installs would leave it a
// runtime require. Runs after that plugin (plugins apply in order) and keeps
// the lib out of the externals; the alias above resolves it to its sources.
class BundleWorkspaceLibsPlugin {
  apply(compiler) {
    const { externals } = compiler.options;
    const list = Array.isArray(externals) ? externals : externals ? [externals] : [];
    compiler.options.externals = list.map((external) =>
      typeof external === 'function'
        ? (ctx, callback) =>
            ctx.request in BUNDLED_WORKSPACE_LIBS ? callback() : external(ctx, callback)
        : external,
    );
  }
}

module.exports = (env = {}) => {
  const bundle = BUNDLES[env.bundle ?? 'server'];
  if (!bundle) {
    throw new Error(`Unknown server bundle "${env.bundle}": expected ${Object.keys(BUNDLES).join(', ')}`);
  }
  return {
    output: { path: join(__dirname, bundle.outputPath) },
    resolve: { alias: BUNDLED_WORKSPACE_LIBS },
    plugins: [
      new NxAppWebpackPlugin({
        target: 'node',
        compiler: 'tsc',
        main: bundle.main,
        tsConfig: './tsconfig.app.json',
        outputPath: bundle.outputPath,
        optimization: false,
        outputHashing: 'none',
        sourceMap: true,
        generatePackageJson: bundle.generatePackageJson ?? false,
      }),
      new BundleWorkspaceLibsPlugin(),
    ],
  };
};
