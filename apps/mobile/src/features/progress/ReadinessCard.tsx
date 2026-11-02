import React from "react"
import { ScrollView, StyleSheet, Text, View } from "react-native"

import type { RankReadiness } from "../../shared/api/rank-readiness"
import { Pressable } from "../../shared/components/Pressable"
import { formatRuDay, pluralRu } from "../../shared/format-ru"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { formatLevelWithStripes, swatchBlendsIn } from "../ranks/rank-format"
import { memberName, readinessDigest } from "./coach-progress"

const SHOWN = 5

/**
 * Staff's «Готовы к аттестации» on the Progress tab: who in their groups has
 * met the admission rule for the next level on one ladder, from the same
 * report the admin's grading page uses. Read-only — the grading list itself is
 * kept in the admin.
 */
export function ReadinessCard({
  data,
  onPickLadder,
}: {
  data: RankReadiness
  onPickLadder: (ladderId: string) => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const digest = readinessDigest(data.data, SHOWN)

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Готовы к аттестации</Text>

      {data.ladders.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chips}
        >
          {data.ladders.map((l) => {
            const selected = l.id === data.ladderId
            return (
              <Pressable
                key={l.id}
                onPress={() => onPickLadder(l.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {l.name}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>
      )}

      {digest.ready === 0 ? (
        <Text style={styles.muted}>Пока никто не набрал допуск к следующему уровню.</Text>
      ) : (
        <>
          <Text style={styles.strong}>
            {digest.ready} {pluralRu(digest.ready, "ученик", "ученика", "учеников")}
            {digest.unlisted > 0 && digest.unlisted < digest.ready
              ? ` · ${digest.unlisted} ещё не в списке аттестации`
              : ""}
          </Text>
          <View style={styles.rows}>
            {digest.shown.map((e) => (
              <View key={e.userId} style={styles.row}>
                <View
                  style={[
                    styles.swatch,
                    {
                      backgroundColor: e.current.color ?? theme.colors.mutedFaint,
                      borderColor: swatchBlendsIn(e.current.color, theme.scheme)
                        ? theme.colors.mutedFaint
                        : theme.colors.border,
                    },
                  ]}
                />
                <View style={styles.rowText}>
                  <Text style={styles.name} numberOfLines={2}>
                    {memberName(e)}
                  </Text>
                  <Text style={styles.muted}>
                    {formatLevelWithStripes(e.current.levelName, e.current.stripes)} →{" "}
                    {e.nextLevel.name}
                    {e.pendingGrading
                      ? ` · аттестация ${formatRuDay(e.pendingGrading.date)}`
                      : ""}
                  </Text>
                </View>
              </View>
            ))}
          </View>
          {digest.more > 0 && <Text style={styles.muted}>и ещё {digest.more}</Text>}
        </>
      )}

      {digest.soon > 0 && (
        <Text style={styles.muted}>
          На подходе: {digest.soon} — им ещё не хватает тренировок или недель.
        </Text>
      )}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      gap: theme.spacing(2),
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing(4),
      ...theme.shadows.sm,
    },
    title: { ...theme.typography.label },
    strong: { ...theme.typography.bodyStrong, color: theme.colors.text },
    muted: { ...theme.typography.caption, color: theme.colors.muted },
    chipsScroll: { flexGrow: 0 },
    chips: { gap: theme.spacing(2) },
    chip: {
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(1),
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    chipSelected: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    chipText: { color: theme.colors.text, fontSize: 13, fontWeight: "500" },
    chipTextSelected: { color: theme.colors.accentText, fontWeight: "700" },
    rows: { gap: theme.spacing(2) },
    row: { flexDirection: "row", alignItems: "center", gap: theme.spacing(3) },
    swatch: {
      width: 28,
      height: 14,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
    },
    rowText: { flex: 1, gap: 2 },
    name: { ...theme.typography.body, color: theme.colors.text },
  })
