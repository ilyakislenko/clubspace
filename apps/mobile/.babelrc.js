module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    env: {
      // Strip console.* from production bundles (keep error/warn). Debug logs
      // like the signed HLS playback URL are bearer credentials to paid video
      // and must never reach a release build's logcat.
      production: {
        plugins: [
          ['transform-remove-console', { exclude: ['error', 'warn'] }],
        ],
      },
    },
  };
};
