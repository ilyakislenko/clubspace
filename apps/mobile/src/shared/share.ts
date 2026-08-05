/// <reference lib="dom" />
import { Share } from "react-native"

import { isWeb } from "./platform"

/**
 * Sharing that actually does something in a browser.
 *
 * react-native-web maps `Share.share` onto `navigator.share`, and **rejects
 * outright** when the browser doesn't have it — which is desktop Firefox, older
 * desktop Safari, and any non-HTTPS origin. Every call site caught that
 * rejection and swallowed it, so the button was simply inert: nothing happened,
 * no error, no feedback. On the "no workspace yet" and "access expired"
 * screens that button is the *only* action a locked-out member has.
 *
 * So: use the native sheet when there is one, otherwise put the text on the
 * clipboard, and tell the caller which happened so it can say so.
 */

export type ShareOutcome = "shared" | "copied" | "dismissed" | "unavailable"

type ShareInput = { title?: string; message: string }

const copyToClipboard = async (text: string): Promise<boolean> => {
  const clipboard = (globalThis as { navigator?: Navigator }).navigator?.clipboard
  if (!clipboard?.writeText) return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    // Denied permission, or not a secure context.
    return false
  }
}

export const shareText = async ({
  title,
  message,
}: ShareInput): Promise<ShareOutcome> => {
  if (!isWeb) {
    try {
      const result = await Share.share(title ? { title, message } : { message })
      return result.action === Share.dismissedAction ? "dismissed" : "shared"
    } catch {
      return "unavailable"
    }
  }

  const nav = (globalThis as { navigator?: Navigator }).navigator
  if (typeof nav?.share === "function") {
    try {
      await nav.share(title ? { title, text: message } : { text: message })
      return "shared"
    } catch (error) {
      // Cancelling the OS sheet rejects with AbortError — that's a decision,
      // not a failure, so don't fall back to copying behind the user's back.
      if ((error as { name?: string } | null)?.name === "AbortError") {
        return "dismissed"
      }
    }
  }

  return (await copyToClipboard(message)) ? "copied" : "unavailable"
}

/** What to tell the member after `shareText`. `null` = say nothing. */
export const shareFeedback = (outcome: ShareOutcome): string | null => {
  switch (outcome) {
    case "copied":
      return "Скопировано — вставьте в любой мессенджер"
    case "unavailable":
      return "Не удалось поделиться. Скопируйте текст вручную."
    default:
      return null
  }
}
