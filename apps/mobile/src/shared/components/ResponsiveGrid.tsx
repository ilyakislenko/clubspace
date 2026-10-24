import React, { Children, type ReactNode } from "react"
import { StyleSheet, View } from "react-native"

import {
  columnsFor,
  type ColumnsBySizeClass,
} from "../size-class"
import { useResponsive } from "../useResponsive"

/**
 * Lays its children out in a wrapping grid on medium / expanded windows
 * (default 1 / 2 / 3 columns). With one column it renders the children as a
 * bare Fragment — no wrapper View — so a phone's layout is untouched. With
 * fewer items than columns they share the row (a lone card spans the width).
 *
 * Cells in a row stretch to the tallest one; a card that should fill its cell
 * sets `flexGrow: 1` on itself. Cells carry their own bottom gap, and the
 * container pulls it back, so the parent's `gap` still spaces the grid from its
 * siblings.
 */
export function ResponsiveGrid({
  children,
  columns,
  gap,
}: {
  children: ReactNode
  columns?: ColumnsBySizeClass
  gap?: number
}) {
  const { sizeClass, gridGap } = useResponsive()
  // eslint-disable-next-line react/jsx-no-useless-fragment -- ReactNode -> element
  if (columnsFor(sizeClass, columns) === 1) return <>{children}</>
  const items = Children.toArray(children)
  if (items.length === 0) return null
  // Fewer items than columns: let them share the row instead of leaving a gap.
  const n = Math.min(columnsFor(sizeClass, columns), items.length)
  const g = gap ?? gridGap
  return (
    <View
      style={[
        styles.row,
        { marginHorizontal: -g / 2, marginBottom: -g },
      ]}
    >
      {items.map((child, i) => (
        <View
          key={i}
          style={{
            width: `${100 / n}%`,
            paddingHorizontal: g / 2,
            marginBottom: g,
          }}
        >
          {child}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap" },
})
