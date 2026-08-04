import { Alert as RNAlert, type AlertButton } from "react-native"

import { isWeb } from "./platform"

/**
 * The app's confirmation/notice dialog. Import this instead of react-native's
 * `Alert` — an eslint rule enforces it (see eslint.config.mjs).
 *
 * react-native-web's `Alert.alert` is **an empty function**. Every dialog in
 * this app was therefore a silent no-op in the browser: "Удалить запись?" never
 * appeared and the entry was never deleted, long-pressing a course to pin it did
 * nothing, "Удалить аккаунт?" did nothing, and error notices like "Не удалось
 * удалить аккаунт" were invisible — the member just saw a button that appeared
 * to do nothing at all.
 *
 * On web this maps the React Native API onto the browser's own dialogs. They're
 * plain and unstyled, but they're synchronous, reliable and impossible to miss,
 * which beats a confirmation that silently doesn't happen.
 */

/** Which button a browser "OK" should run. */
const confirmButton = (buttons: readonly AlertButton[]): AlertButton | undefined => {
  const actions = buttons.filter((button) => button.style !== "cancel")
  // React Native convention puts the primary action last.
  return actions[actions.length - 1]
}

const cancelButton = (buttons: readonly AlertButton[]): AlertButton | undefined =>
  buttons.find((button) => button.style === "cancel")

const asText = (title: string, message?: string): string =>
  message ? `${title}\n\n${message}` : title

export const showAlert = (
  title: string,
  message?: string,
  buttons?: AlertButton[],
): void => {
  if (!isWeb) {
    RNAlert.alert(title, message, buttons)
    return
  }

  const dialogs = globalThis as {
    alert?: (text: string) => void
    confirm?: (text: string) => boolean
  }
  const actions = buttons ?? []
  const confirm = confirmButton(actions)
  const cancel = cancelButton(actions)

  // A notice: one button, or none. Nothing to decide, so don't ask a question.
  if (!cancel) {
    dialogs.alert?.(asText(title, message))
    confirm?.onPress?.()
    return
  }

  const accepted = dialogs.confirm?.(asText(title, message)) ?? false
  if (accepted) confirm?.onPress?.()
  else cancel.onPress?.()
}
