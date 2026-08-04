import React from "react"
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native"

/**
 * The decorative "›" that marks a row as tappable.
 *
 * It carries no information — the row's label already says where it goes — so
 * it has to be hidden from assistive tech. React Native's
 * `accessibilityElementsHidden` / `importantForAccessibility` do that natively
 * but react-native-web ignores both, which left every row on the web build
 * announcing itself as "Уведомления›". `aria-hidden` is what RNW reads, and it
 * is inert on native.
 */
export function Chevron({ style }: { style?: StyleProp<TextStyle> }) {
  return (
    <Text
      style={[styles.glyph, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      ›
    </Text>
  )
}

const styles = StyleSheet.create({
  // Callers pass the themed colour/size; this only guards against a stray
  // selection highlight when someone drags across a list on desktop.
  glyph: { userSelect: "none" },
})
