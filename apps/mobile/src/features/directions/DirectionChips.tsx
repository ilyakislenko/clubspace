import React from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import type { DirectionRef } from "../../shared/api/directions"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { DirectionDot } from "./DirectionTag"

// One direction («Все» = null) or, in the multi mode, any number of them
// («Все» = none; the caller toggles a tapped direction in or out).
type Selection =
  | { selectedId: string | null; onSelect: (id: string | null) => void }
  | { selectedIds: readonly string[]; onToggle: (id: string | null) => void }

/**
 * A horizontal «Все» + one-chip-per-direction filter row. Renders nothing
 * when the club has no directions, so such clubs look exactly as before.
 * `wrap` lays the chips out in wrapping lines instead (inside a sheet).
 */
export function DirectionChips({
  directions,
  wrap = false,
  ...selection
}: {
  directions: readonly DirectionRef[]
  wrap?: boolean
} & Selection) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  if (directions.length === 0) return null
  const chips: { id: string | null; label: string; color?: string | null }[] = [
    { id: null, label: "Все" },
    // The colour dot tells directions apart; no emoji in the label.
    ...directions.map((d) => ({
      id: d.id,
      label: d.name,
      color: d.color,
    })),
  ]
  const items = chips.map((c) => {
    const selected =
      "selectedIds" in selection
        ? c.id === null
          ? selection.selectedIds.length === 0
          : selection.selectedIds.includes(c.id)
        : c.id === selection.selectedId
    return (
      <Pressable
        key={c.id ?? "all"}
        onPress={() =>
          "selectedIds" in selection
            ? selection.onToggle(c.id)
            : selection.onSelect(c.id)
        }
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={c.id ? `Направление: ${c.label}` : "Все направления"}
        style={[styles.chip, selected && styles.chipSelected]}
      >
        {c.id !== null && (
          <DirectionDot
            color={c.color ?? null}
            fallback={
              selected ? theme.colors.accentText : theme.colors.mutedFaint
            }
          />
        )}
        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
          {c.label}
        </Text>
      </Pressable>
    )
  })
  if (wrap) {
    return (
      <View style={[styles.chips, styles.wrap]} accessibilityLabel="Направления">
        {items}
      </View>
    )
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.chips}
      accessibilityLabel="Направления"
    >
      {items}
    </ScrollView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    scroll: { flexGrow: 0 },
    chips: { gap: theme.spacing(2) },
    wrap: { flexDirection: "row", flexWrap: "wrap" },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1) + 2,
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    chipSelected: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    chipText: { color: theme.colors.text, fontSize: 14, fontWeight: "500" },
    chipTextSelected: { color: theme.colors.accentText, fontWeight: "700" },
  })
