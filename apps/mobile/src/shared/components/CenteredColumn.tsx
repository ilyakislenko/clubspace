import type { ReactNode } from "react"
import { StyleSheet, View, type ViewStyle } from "react-native"

// Caps a screen's content to a readable column and centers it. Deliberately
// unconditional: on a phone the viewport is narrower than `maxWidth`, so
// `alignSelf: "center"` is a no-op and the layout is byte-for-byte the mobile
// one; on a desktop browser (or tablet-landscape) the content stops stretching
// edge-to-edge and sits centered. Keeps flex:1 so an inner ScrollView/FlatList
// still fills the height and scrolls.
export function CenteredColumn({
  children,
  maxWidth = 900,
  style,
}: {
  children: ReactNode
  maxWidth?: number
  style?: ViewStyle
}) {
  return <View style={[styles.base, { maxWidth }, style]}>{children}</View>
}

const styles = StyleSheet.create({
  base: { flex: 1, width: "100%", alignSelf: "center" },
})
