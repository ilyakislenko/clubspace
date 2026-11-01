import React from "react"
import { StyleSheet, Text, View } from "react-native"

import type { DirectionRef } from "../../shared/api/directions"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { DirectionTag } from "../directions/DirectionTag"

/**
 * The directions an abonement (or tariff) may be spent on, as chips. A
 * club-wide one (empty set) renders nothing unless `showClubWide` — set it only
 * where it contrasts with scoped neighbours, so a club without directions never
 * sees an extra chip.
 */
export function AbonementScopeChips({
  directions,
  showClubWide = false,
}: {
  directions: readonly DirectionRef[]
  showClubWide?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  if (directions.length === 0) {
    if (!showClubWide) return null
    return (
      <View style={styles.row}>
        <View style={styles.chip} accessibilityLabel="Действует на весь клуб">
          <Text style={styles.label}>Весь клуб</Text>
        </View>
      </View>
    )
  }
  return (
    <View style={styles.row}>
      {directions.map((d) => (
        <DirectionTag key={d.id} direction={d} chip />
      ))}
    </View>
  )
}

/** Whether a list mixes scoped and club-wide items (then «Весь клуб» is shown). */
export const hasScoped = (
  items: readonly { directions: readonly unknown[] }[],
): boolean => items.some((i) => i.directions.length > 0)

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    row: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing(1) },
    chip: {
      paddingHorizontal: theme.spacing(2) + 2,
      paddingVertical: theme.spacing(1),
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    label: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  })
