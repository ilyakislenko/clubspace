import Ionicons from "@expo/vector-icons/Ionicons"
import React, { type ComponentProps } from "react"

/**
 * The app's icon: an Ionicons glyph that assistive tech never sees. Import this
 * instead of Ionicons.
 *
 * An icon font draws a glyph from a private-use character, so a bare Ionicons
 * inside a row became part of the row's spoken label — VoiceOver read
 * «, Настройки» for a gear + «Настройки». Every icon here sits next to text or
 * inside a control whose own label says what it does, so the glyph is
 * decoration. `accessibilityElementsHidden` (iOS, also skipped when a parent
 * builds its label from children) and `importantForAccessibility` (Android) do
 * that natively; react-native-web ignores both and reads `aria-hidden`.
 */
export function Icon(props: ComponentProps<typeof Ionicons>) {
  return (
    <Ionicons
      {...props}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    />
  )
}
