import React, { type ReactNode } from "react"
import { StyleSheet, View } from "react-native"

import { useResponsive } from "../useResponsive"

// Width of the fixed column beside the main content on expanded windows.
export const SPLIT_SIDE_WIDTH = 360

/**
 * Main content plus a fixed-width side column on expanded windows; on compact
 * / medium it renders `main` then `side` (or `side` first with
 * `stackSideFirst`) as a bare Fragment, so the parent's own spacing applies and
 * a phone's layout is untouched. Neither column stretches short content.
 */
export function SplitLayout({
  main,
  side,
  sideWidth = SPLIT_SIDE_WIDTH,
  sidePosition = "end",
  stackSideFirst = false,
}: {
  main: ReactNode
  side: ReactNode
  sideWidth?: number
  sidePosition?: "start" | "end"
  stackSideFirst?: boolean
}) {
  const { sizeClass, gridGap } = useResponsive()
  if (sizeClass !== "expanded") {
    return stackSideFirst ? (
      <>
        {side}
        {main}
      </>
    ) : (
      <>
        {main}
        {side}
      </>
    )
  }
  const mainCol = (
    <View key="main" style={[styles.main, { gap: gridGap }]}>
      {main}
    </View>
  )
  const sideCol = (
    <View key="side" style={[{ width: sideWidth, gap: gridGap }, styles.side]}>
      {side}
    </View>
  )
  return (
    <View style={[styles.row, { gap: gridGap }]}>
      {sidePosition === "start" ? [sideCol, mainCol] : [mainCol, sideCol]}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  main: { flex: 1, minWidth: 0 },
  side: { flexShrink: 0 },
})
