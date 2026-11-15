import React, { useState } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"

// The server reads at most this many raw characters of a code.
const PROMO_CODE_MAX = 40

/**
 * «Есть промокод?»: a link that opens one row — the code (auto-caps) and
 * «Применить». The host quotes the price with the code and passes back why
 * the code changed nothing (`note`, the server's words). Editing the code
 * drops what was applied (`onEdit`), so a payment never carries a code the
 * member no longer sees.
 */
export function PromoCodeField({
  busy,
  note,
  onApply,
  onEdit,
}: {
  busy: boolean
  note: string | null
  onApply: (code: string) => void
  onEdit: () => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState("")
  const trimmed = code.trim()

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        style={styles.link}
      >
        <Text style={styles.linkText}>Есть промокод?</Text>
      </Pressable>
    )
  }

  const apply = () => {
    if (trimmed && !busy) onApply(trimmed)
  }

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <TextInput
          value={code}
          onChangeText={(next) => {
            setCode(next)
            onEdit()
          }}
          onSubmitEditing={apply}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          maxLength={PROMO_CODE_MAX}
          placeholder="Промокод"
          placeholderTextColor={theme.colors.muted}
          accessibilityLabel="Промокод"
          returnKeyType="done"
          style={styles.input}
        />
        <Pressable
          onPress={apply}
          disabled={!trimmed || busy}
          accessibilityRole="button"
          style={[styles.apply, (!trimmed || busy) && styles.disabled]}
        >
          {busy ? (
            <ActivityIndicator color={theme.colors.text} />
          ) : (
            <Text style={styles.applyText}>Применить</Text>
          )}
        </Pressable>
      </View>
      {note && <Text style={styles.note}>{note}</Text>}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { gap: theme.spacing(1) },
    link: { alignSelf: "flex-start", paddingVertical: theme.spacing(1) },
    linkText: { color: theme.colors.accent, fontSize: 14, fontWeight: "600" },
    row: { flexDirection: "row", gap: theme.spacing(2), alignItems: "center" },
    input: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 15,
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
    },
    apply: {
      minWidth: 112,
      minHeight: 44,
      paddingHorizontal: theme.spacing(4),
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    applyText: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
    disabled: { opacity: 0.5 },
    // The warning tone (`toneColor(…, "warn")`).
    note: { color: theme.colors.accent, fontSize: 13 },
  })
