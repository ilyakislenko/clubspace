// The app's identity comes from the build env, not a static app.json: the
// neutral «ClubSpace» app by default, a club's own branded app on request.
// See src/app-variant.js and docs/store-distribution.md.
module.exports = () =>
  require("./src/app-variant").resolveAppConfig(process.env)
