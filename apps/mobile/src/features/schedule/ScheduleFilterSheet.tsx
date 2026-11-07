import React from "react"
import { StyleSheet, Text, View } from "react-native"

import type { DirectionRef } from "../../shared/api/directions"
import { Pressable } from "../../shared/components/Pressable"
import { Sheet } from "../../shared/components/Sheet"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { DirectionChips } from "../directions/DirectionChips"

/**
 * The schedule's filters behind the «Фильтр» button: the direction (when the
 * club has directions) and «Мои группы» / a gym (when there is a choice). A
 * pick applies at once; «Сбросить» goes back to everything.
 */
export function ScheduleFilterSheet({
  directions,
  directionId,
  onDirection,
  chips,
  filterId,
  onFilter,
  onReset,
  onClose,
}: {
  directions: readonly DirectionRef[]
  directionId: string | null
  onDirection: (id: string | null) => void
  // The gym/group chips, or null when there is nothing to pick.
  chips: ReadonlyArray<{ id: string | null; name: string }> | null
  filterId: string | null
  onFilter: (id: string | null) => void
  onReset: () => void
  onClose: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  const filtered = !!directionId || !!filterId

  return (
    <Sheet title="Фильтр" onClose={onClose}>
      {directions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Направление</Text>
          <DirectionChips
            directions={directions}
            selectedId={directionId}
            onSelect={onDirection}
            wrap
          />
        </View>
      )}

      {chips && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Группы и залы</Text>
          <View style={styles.chips}>
            {chips.map((c) => {
              const selected = c.id === filterId
              return (
                <Pressable
                  key={c.id ?? "all"}
                  onPress={() => onFilter(c.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text
                    style={[styles.chipText, selected && styles.chipTextSelected]}
                  >
                    {c.name}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={onReset}
          disabled={!filtered}
          accessibilityRole="button"
          accessibilityState={{ disabled: !filtered }}
          style={[
            styles.button,
            styles.buttonSecondary,
            !filtered && styles.buttonDisabled,
          ]}
        >
          <Text style={styles.buttonSecondaryText}>Сбросить</Text>
        </Pressable>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          style={[styles.button, styles.buttonPrimary]}
        >
          <Text style={styles.buttonPrimaryText}>Готово</Text>
        </Pressable>
      </View>
    </Sheet>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    section: { gap: theme.spacing(2) },
    sectionTitle: { ...theme.typography.label, color: theme.colors.muted },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing(2),
    },
    chip: {
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
    actions: {
      flexDirection: "row",
      gap: theme.spacing(3),
      marginTop: theme.spacing(2),
    },
    button: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
    },
    buttonPrimary: { backgroundColor: theme.colors.accent },
    buttonPrimaryText: {
      color: theme.colors.accentText,
      fontSize: 15,
      fontWeight: "700",
    },
    buttonSecondary: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    buttonSecondaryText: {
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "600",
    },
    buttonDisabled: { opacity: 0.4 },
  })
