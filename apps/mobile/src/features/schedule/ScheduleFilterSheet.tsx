import React from "react"
import { StyleSheet, Text, View } from "react-native"

import type { DirectionRef } from "../../shared/api/directions"
import { Pressable } from "../../shared/components/Pressable"
import { Sheet } from "../../shared/components/Sheet"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { DirectionChips } from "../directions/DirectionChips"

/**
 * The schedule's filters behind the «Фильтр» button: directions (when the
 * club has directions) and «Мои группы» / gyms (when there is a choice).
 * Several directions or gyms can be picked; «Все» clears a section. A pick
 * applies at once; «Сбросить» goes back to everything.
 */
export function ScheduleFilterSheet({
  directions,
  directionIds,
  onToggleDirection,
  chips,
  filterIds,
  onToggleFilter,
  onReset,
  onClose,
}: {
  directions: readonly DirectionRef[]
  directionIds: readonly string[]
  onToggleDirection: (id: string | null) => void
  // The gym/group chips, or null when there is nothing to pick.
  chips: ReadonlyArray<{ id: string | null; name: string }> | null
  filterIds: readonly string[]
  onToggleFilter: (id: string | null) => void
  onReset: () => void
  onClose: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  const filtered = directionIds.length > 0 || filterIds.length > 0

  return (
    <Sheet title="Фильтр" onClose={onClose}>
      {directions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Направления</Text>
          <DirectionChips
            directions={directions}
            selectedIds={directionIds}
            onToggle={onToggleDirection}
            wrap
          />
        </View>
      )}

      {chips && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Группы и залы</Text>
          <View style={styles.chips}>
            {chips.map((c) => {
              const selected =
                c.id === null ? filterIds.length === 0 : filterIds.includes(c.id)
              return (
                <Pressable
                  key={c.id ?? "all"}
                  onPress={() => onToggleFilter(c.id)}
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
    sectionTitle: { ...theme.typography.bodyStrong, color: theme.colors.text },
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
