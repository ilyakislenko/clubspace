import React from "react"
import { StyleSheet, Text, View } from "react-native"

import type { DependentRelation } from "../../shared/api/dependents"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { CONSENT_TEXT, RELATION_LABEL, RELATION_ORDER } from "./children-helpers"

/** The parental consent the server requires to add or confirm a child. */
export function ConsentCheckbox({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (next: boolean) => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={CONSENT_TEXT}
      style={styles.consent}
    >
      <Icon
        name={checked ? "checkbox" : "square-outline"}
        size={22}
        color={checked ? theme.colors.accent : theme.colors.muted}
      />
      <Text style={styles.consentText}>{CONSENT_TEXT}</Text>
    </Pressable>
  )
}

/** «Кем приходитесь»: parent, guardian or other. */
export function RelationPicker({
  value,
  onChange,
}: {
  value: DependentRelation
  onChange: (next: DependentRelation) => void
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.field}>
      <Text style={styles.label}>Кем приходитесь</Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {RELATION_ORDER.map((r) => {
          const active = r === value
          return (
            <Pressable
              key={r}
              onPress={() => onChange(r)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {RELATION_LABEL[r]}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    consent: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing(2),
    },
    consentText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      color: theme.colors.textSecondary,
    },
    field: { gap: theme.spacing(1) },
    label: { ...theme.typography.label },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing(2) },
    chip: {
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    chipActive: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accentSoft,
    },
    chipText: { fontSize: 14, fontWeight: "600", color: theme.colors.text },
    chipTextActive: { color: theme.colors.accent },
  })
