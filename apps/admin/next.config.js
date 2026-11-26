//@ts-check
const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');

/**
 * @param {string} phase
 * @returns {import('next').NextConfig}
 */
module.exports = (phase) => ({
  // Self-contained server output for a small production Docker image.
  output: 'standalone',
  // Builds land in the workspace dist/ (the Dockerfile and the admin smoke e2e
  // copy them from there); `next dev` keeps `.next` in the app, where
  // Turbopack expects it.
  distDir:
    phase === PHASE_DEVELOPMENT_SERVER ? '.next' : '../../dist/apps/admin/.next',
});
