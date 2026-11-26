import React from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import { useAuth } from "../../shared/auth-context"
import { choiceA11y } from "../../shared/choice-a11y"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  dependentName,
  switchableDependents,
  switcherName,
} from "./children-helpers"
import { useProfileSwitch } from "./useProfileSwitch"

/**
 * «Я / <имя ребёнка>»: whom the app acts for. Only confirmed children are
 * offered. Renders nothing for a guardian without confirmed children.
 */
export function ProfileSwitcher() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { actingAs, dependents } = useAuth()
  const { busy, switchTo } = useProfileSwitch()
  const children = switchableDependents(dependents)

  // A child that is the active profile stays listed even before the list loads.
  if (children.length === 0 && !actingAs) return null

  const options = [
    { id: null, key: "self", label: "Я", full: "" },
    ...(children.length > 0
      ? children.map((d) => ({
          id: d.id,
          key: d.id,
          label: switcherName(d, children),
          full: dependentName(d),
        }))
      : actingAs
        ? [
            {
              id: actingAs.id,
              key: actingAs.id,
              label: switcherName(actingAs, [actingAs]),
              full: dependentName(actingAs),
            },
          ]
        : []),
  ]
  const activeId = actingAs?.id ?? null

  return (
    <View style={styles.wrap}>
      {/* Not «Профиль»: on the Profile tab that repeats the screen title. */}
      <Text style={styles.title}>Чей профиль</Text>
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Чей профиль">
        {options.map((o) => {
          const active = o.id === activeId
          const loading = busy === o.key
          return (
            <Pressable
              key={o.key}
              onPress={() => void switchTo(o.id)}
              disabled={active || busy !== null}
              {...choiceA11y("radio", active, { busy: loading })}
              accessibilityLabel={
                o.id ? `Профиль ребёнка: ${o.full}` : "Мой профиль"
              }
              style={[styles.chip, active && styles.chipActive]}
            >
              {loading ? (
                <ActivityIndicator size="small" color={theme.colors.accent} />
              ) : (
                <Text
                  style={[styles.chipText, active && styles.chipTextActive]}
                  numberOfLines={1}
                >
                  {o.label}
                </Text>
              )}
            </Pressable>
          )
        })}
      </View>
      {actingAs && (
        <Text style={styles.hint}>
          Вы действуете от имени ребёнка: {dependentName(actingAs)}. Запись,
          отметки и абонемент — его.
        </Text>
      )}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: { gap: theme.spacing(2) },
    title: { ...theme.typography.label, paddingHorizontal: theme.spacing(1) },
    row: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing(2) },
    chip: {
      minWidth: 64,
      alignItems: "center",
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceElevated,
    },
    chipActive: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accentSoft,
    },
    chipText: { fontSize: 15, fontWeight: "600", color: theme.colors.text },
    chipTextActive: { color: theme.colors.accent, fontWeight: "700" },
    hint: { ...theme.typography.caption, color: theme.colors.muted },
  })
