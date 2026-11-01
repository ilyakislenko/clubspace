const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { mergeConfig } = require('metro-config');

// Expo's defaults already handle the monorepo (watchFolders, nodeModulesPaths).
// Nx's withNxMetro moved projectRoot to the workspace root, which Expo SDK 58
// no longer supports (Babel then looks for its config there and the bundle
// fails), so the workspace libs are resolved here from the same tsconfig
// `paths` the typecheck uses.
const workspaceRoot = path.resolve(__dirname, '../..');
const { paths } = require('../../tsconfig.base.json').compilerOptions;
const workspaceLibs = Object.fromEntries(
  Object.entries(paths).map(([alias, [target]]) => [
    alias,
    path.join(workspaceRoot, target),
  ]),
);

const defaultConfig = getDefaultConfig(__dirname);
const { assetExts, sourceExts } = defaultConfig.resolver;

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const customConfig = {
  cacheVersion: '@clubspace/mobile',
  transformer: {
    babelTransformerPath: require.resolve('react-native-svg-transformer'),
  },
  resolver: {
    assetExts: assetExts.filter((ext) => ext !== 'svg'),
    sourceExts: [...sourceExts, 'cjs', 'mjs', 'svg'],
    resolveRequest: (context, moduleName, platform) =>
      context.resolveRequest(
        context,
        workspaceLibs[moduleName] ?? moduleName,
        platform,
      ),
  },
};

module.exports = mergeConfig(defaultConfig, customConfig);
