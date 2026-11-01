import React from "react"
import { ScrollView, StyleSheet, Text } from "react-native"

import type { DirectionRef } from "../../shared/api/directions"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { DirectionDot } from "./DirectionTag"

/**
 * A horizontal «Все» + one-chip-per-direction filter row. Renders nothing
 * when the club has no directions, so such clubs look exactly as before.
 */
export function DirectionChips({
  directions,
  selectedId,
  onSelect,
}: {
  directions: readonly DirectionRef[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  if (directions.length === 0) return null
  const chips: { id: string | null; label: string; color?: string | null }[] = [
    { id: null, label: "Все" },
    ...directions.map((d) => ({
      id: d.id,
      label: d.icon ? `${d.icon} ${d.name}` : d.name,
      color: d.color,
    })),
  ]
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.chips}
      accessibilityLabel="Направления"
    >
      {chips.map((c) => {
        const selected = c.id === selectedId
        return (
          <Pressable
            key={c.id ?? "all"}
            onPress={() => onSelect(c.id)}
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
      })}
    </ScrollView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    scroll: { flexGrow: 0 },
    chips: { gap: theme.spacing(2) },
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
