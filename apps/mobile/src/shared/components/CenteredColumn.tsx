import type { ReactNode } from "react"
import { StyleSheet, View, type ViewStyle } from "react-native"

import { useResponsive } from "../useResponsive"

// Width for reading / list screens (notifications, attendance, settings…);
// grid and dashboard screens pass `DASHBOARD_WIDTH` instead.
export const READABLE_WIDTH = 720
export const DASHBOARD_WIDTH = 1200

// Caps a screen's content to a readable column and centers it. Deliberately
// unconditional: on a phone the viewport is narrower than `maxWidth`, so
// `alignSelf: "center"` is a no-op and the layout is byte-for-byte the mobile
// one; on a desktop browser (or tablet-landscape) the content stops stretching
// edge-to-edge and sits centered. Keeps flex:1 so an inner ScrollView/FlatList
// still fills the height and scrolls.
//
// On medium / expanded windows it also adds the extra page padding on top of
// the 16 dp the screens already apply themselves (none on phones).
export function CenteredColumn({
  children,
  maxWidth = 900,
  style,
}: {
  children: ReactNode
  maxWidth?: number
  style?: ViewStyle
}) {
  const { sizeClass, pagePadding } = useResponsive()
  return (
    <View
      style={[
        styles.base,
        { maxWidth },
        sizeClass !== "compact" && {
          paddingHorizontal: pagePadding - SCREEN_PADDING,
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

// What screens already pad themselves with.
const SCREEN_PADDING = 16

const styles = StyleSheet.create({
  base: { flex: 1, width: "100%", alignSelf: "center" },
})
