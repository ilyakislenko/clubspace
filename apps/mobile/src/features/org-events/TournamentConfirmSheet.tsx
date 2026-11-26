import React, { useState } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import {
  confirmTournamentEntry,
  type ClubTournamentAthlete,
  type ClubTournamentEntry,
  type ClubTournamentLevel,
} from "../../shared/api/tournaments"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import { Sheet, useSheetAction } from "../../shared/components/Sheet"
import { errorMessage } from "../../shared/error-message"
import { haptics } from "../../shared/haptics"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { athleteFactsLine } from "./tournament-helpers"

/**
 * The coach confirms a student's declaration: weight, sex, birth year and
 * the belt — from the federation registry, or picked here on the
 * federation's standard when the registry has none. The system then finds
 * the division; `onConfirmed` gets the entry (its division, or none —
 * «категорию назначит федерация»).
 */
export function TournamentConfirmSheet({
  workspaceId,
  athlete,
  levels,
  onConfirmed,
  onClosed,
}: {
  workspaceId: string
  athlete: ClubTournamentAthlete
  levels: readonly ClubTournamentLevel[]
  onConfirmed: (entry: ClubTournamentEntry) => void
  onClosed: () => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const sheet = useSheetAction({ initiallyOpen: true, onClosed })
  const [levelId, setLevelId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const entry = athlete.entry
  const registry = athlete.registryLevel
  const needsPick = !registry && levels.length > 0
  // Several standards (adults / children): each level says which.
  const severalStandards = new Set(levels.map((l) => l.templateId)).size > 1

  const confirm = async () => {
    if (!entry) return
    if (needsPick && !levelId) {
      setError("Укажите пояс по стандарту федерации")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = await confirmTournamentEntry({
        workspaceId,
        entryId: entry.id,
        templateLevelId: registry ? undefined : (levelId ?? undefined),
      })
      haptics.success()
      sheet.run(() => onConfirmed(saved))
    } catch (e) {
      setError(errorMessage(e, "Не удалось подтвердить заявку"))
      setBusy(false)
    }
  }

  return (
    <Sheet title={athlete.name} {...sheet.sheetProps}>
      <View style={styles.body}>
        {entry && <Text style={styles.facts}>{athleteFactsLine(entry)}</Text>}
        {registry ? (
          <Text style={styles.text}>Пояс: {registry.name} (из реестра федерации)</Text>
        ) : needsPick ? (
          <View style={styles.field}>
            <Text style={styles.label}>Пояс по стандарту федерации</Text>
            <View accessibilityRole="radiogroup">
              {levels.map((l) => {
                const active = l.id === levelId
                return (
                  <Pressable
                    key={l.id}
                    onPress={() => setLevelId(l.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    style={styles.option}
                  >
                    <Text style={[styles.text, styles.optionText]}>
                      {severalStandards ? `${l.name} · ${l.templateName}` : l.name}
                    </Text>
                    {active && <Icon name="checkmark" size={20} color={theme.colors.accent} />}
                  </Pressable>
                )
              })}
            </View>
          </View>
        ) : null}
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable
          onPress={() => void confirm()}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        >
          {busy ? (
            <ActivityIndicator color={theme.colors.accentText} />
          ) : (
            <Text style={styles.primaryText}>Подтвердить</Text>
          )}
        </Pressable>
      </View>
    </Sheet>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    body: { gap: theme.spacing(3) },
    facts: { ...theme.typography.bodyStrong, color: theme.colors.text },
    field: { gap: theme.spacing(1) },
    label: { ...theme.typography.label },
    text: { fontSize: 15, color: theme.colors.text },
    option: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 48,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    optionText: { flex: 1 },
    error: { fontSize: 13, color: theme.colors.danger },
    primary: {
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryText: { color: theme.colors.accentText, fontSize: 15, fontWeight: "700" },
    pressed: { opacity: 0.85 },
  })
