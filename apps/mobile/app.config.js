// app.json stays the source of the default app; this only layers the opt-in
// club-picker build on top (see src/app-variant.js).
module.exports = ({ config }) =>
  require("./src/app-variant").resolveAppVariant(config, process.env)
