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
 * bare Fragment — no wrapper View — so a phone's layout is untouched. Cells
 * keep the column width even when there are fewer items than columns, so a
 * single group or gym doesn't stretch across a tablet; `fill` lets fewer items
 * share the row instead (a dashboard row of one or two cards).
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
  fill = false,
}: {
  children: ReactNode
  columns?: ColumnsBySizeClass
  gap?: number
  fill?: boolean
}) {
  const { sizeClass, gridGap } = useResponsive()
  // eslint-disable-next-line react/jsx-no-useless-fragment -- ReactNode -> element
  if (columnsFor(sizeClass, columns) === 1) return <>{children}</>
  const items = Children.toArray(children)
  if (items.length === 0) return null
  const cols = columnsFor(sizeClass, columns)
  const n = fill ? Math.min(cols, items.length) : cols
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
