import * as Haptics from "expo-haptics"

// Haptics is a native module. In a dev client that predates adding expo-haptics
// the call throws (or rejects) — we swallow it so feedback is purely additive
// and never crashes a screen. Once the app is rebuilt, the taps come through.
const safe = (run: () => Promise<unknown>) => {
  try {
    void run().catch(() => undefined)
  } catch {
    /* native module unavailable in this build */
  }
}

/**
 * Tiny tactile-feedback facade. Use `light` for routine toggles (favorite,
 * pin), `success`/`warning` for outcomes the user should feel landed, and
 * `selection` for picker-style changes.
 */
export const haptics = {
  light: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () =>
    safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () =>
    safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () =>
    safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  selection: () => safe(() => Haptics.selectionAsync()),
}
