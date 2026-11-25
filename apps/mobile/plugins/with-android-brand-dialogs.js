// Native Android dialogs (Alert.alert behind shared/alert.ts) take their look
// from the activity theme, which prebuild leaves at AppCompat's defaults:
// teal, UPPERCASE buttons («НЕТ», «ОТМЕНИТЬ ЗАМЕНУ») next to the brand's
// sentence-case UI. This gives the theme the brand accent and the dialog
// buttons sentence case.
const { AndroidConfig, withAndroidStyles } = require("expo/config-plugins")

const { assignStylesValue, getAppThemeGroup } = AndroidConfig.Styles

const DIALOG = { name: "AppAlertDialog", parent: "Theme.AppCompat.DayNight.Dialog.Alert" }
const DIALOG_BUTTON = {
  name: "AppAlertDialogButton",
  parent: "Widget.AppCompat.Button.ButtonBar.AlertDialog",
}

module.exports = function withAndroidBrandDialogs(config, { color }) {
  return withAndroidStyles(config, (cfg) => {
    let xml = cfg.modResults
    const set = (parent, name, value) => {
      xml = assignStylesValue(xml, { add: true, parent, name, value })
    }
    set(getAppThemeGroup(), "colorAccent", color)
    set(getAppThemeGroup(), "alertDialogTheme", `@style/${DIALOG.name}`)
    set(DIALOG, "colorAccent", color)
    set(DIALOG, "buttonBarButtonStyle", `@style/${DIALOG_BUTTON.name}`)
    set(DIALOG_BUTTON, "textAllCaps", "false")
    cfg.modResults = xml
    return cfg
  })
}
