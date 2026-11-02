/**
 * Native press feedback for the app's Pressable. Android gives a bare Pressable
 * no visual response at all (no ripple unless asked for), so rows felt dead.
 * Dimming works on both platforms and needs no per-caller wiring.
 */
export const PRESSED_OPACITY = 0.7

type PressFeedbackInput = {
  role: string | undefined
  disabled: boolean | null | undefined
  hasHandler: boolean
}

// Structural pressables (role "none": a modal's backdrop and sheet) and ones
// that can't be pressed must not react — same rule as the web hover dim.
export const hasPressFeedback = ({
  role,
  disabled,
  hasHandler,
}: PressFeedbackInput): boolean => hasHandler && !disabled && role !== "none"

// A structural pressable (role "none": a modal's backdrop and the sheet that
// swallows taps) is not one thing to a screen reader. As an accessibility
// element — React Native's default for every Pressable — it took the whole
// sheet with it: VoiceOver/TalkBack read the sheet as a single block and its
// buttons could not be reached one by one. An explicit `accessible` wins.
export const isAccessibilityElement = (
  role: string | undefined,
  accessible: boolean | null | undefined,
): boolean => accessible ?? role !== "none"
