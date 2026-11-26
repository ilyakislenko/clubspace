import { Platform } from "react-native"
import type { AccessibilityRole, AccessibilityState, AccessibilityValue } from "react-native"

type ChoiceA11y = {
  accessibilityRole: AccessibilityRole
  accessibilityState: AccessibilityState
  accessibilityValue?: AccessibilityValue
}

/**
 * Screen-reader role and state of one option (radio) or a checkbox. iOS has
 * neither trait, so React Native adds its own English words to what VoiceOver
 * reads — «radio button», «checkbox, checked» — even on a Russian iPhone. There
 * a choice is a button with the «selected» trait, which VoiceOver announces in
 * the phone's language («выбрано»). An unselected button says nothing, which
 * is right for an option but hides an empty checkbox, so a checkbox also reads
 * «отмечено» / «не отмечено». TalkBack and the browser know both roles.
 */
export function choiceA11y(
  kind: "radio" | "checkbox",
  checked: boolean,
  state: Pick<AccessibilityState, "disabled" | "busy"> = {},
): ChoiceA11y {
  if (Platform.OS !== "ios") {
    return { accessibilityRole: kind, accessibilityState: { ...state, checked } }
  }
  const ios: ChoiceA11y = { accessibilityRole: "button", accessibilityState: { ...state, selected: checked } }
  if (kind === "checkbox") ios.accessibilityValue = { text: checked ? "отмечено" : "не отмечено" }
  return ios
}
