import { Platform } from "react-native"
import type { AccessibilityRole, AccessibilityState } from "react-native"

type ChoiceA11y = {
  accessibilityRole: AccessibilityRole
  accessibilityState: AccessibilityState
}

/**
 * Screen-reader role and state of one option (radio) or a checkbox. iOS has
 * neither trait, so React Native adds its own English words to what VoiceOver
 * reads — «radio button», «checkbox, checked» — even on a Russian iPhone. There
 * a choice is a button with the «selected» trait, which VoiceOver announces in
 * the phone's language («выбрано»). TalkBack and the browser know both roles.
 */
export function choiceA11y(
  kind: "radio" | "checkbox",
  checked: boolean,
  state: Pick<AccessibilityState, "disabled" | "busy"> = {},
): ChoiceA11y {
  return Platform.OS === "ios"
    ? { accessibilityRole: "button", accessibilityState: { ...state, selected: checked } }
    : { accessibilityRole: kind, accessibilityState: { ...state, checked } }
}
