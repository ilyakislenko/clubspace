import React from "react"
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import type { Promotion } from "../../shared/api/ranks"
import { Chevron } from "../../shared/components/Chevron"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { formatLevelWithStripes, stripeColorOn } from "./rank-format"

/** The member's current rank per ladder; tapping opens the promotion history. */
export function CurrentRankCard({
  ranks,
  onPress,
  style,
}: {
  ranks: Promotion[]
  onPress: () => void
  style?: StyleProp<ViewStyle>
}) {
  const styles = useThemedStyles(makeStyles)
  const summary = ranks
    .map(
      (p) => `${p.ladderName}: ${formatLevelWithStripes(p.levelName, p.stripes)}`,
    )
    .join(", ")
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Ранг: ${summary}`}
      accessibilityHint="Открыть историю повышений"
      style={[styles.rankBlock, style]}
    >
      <View style={styles.rankRows}>
        {ranks.map((p) => (
          <RankRow key={p.id} promotion={p} />
        ))}
      </View>
      <Chevron style={styles.actionChev} />
    </Pressable>
  )
}

function RankRow({ promotion }: { promotion: Promotion }) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const color = promotion.color ?? theme.colors.mutedFaint
  return (
    <View style={styles.rankRow}>
      <View
        style={[styles.rankSwatch, { backgroundColor: color, borderColor: color }]}
      >
        <View style={styles.rankStripes}>
          {Array.from({ length: promotion.stripes }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.rankStripe,
                { backgroundColor: stripeColorOn(color) },
              ]}
            />
          ))}
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rankLadder}>{promotion.ladderName}</Text>
        <Text style={styles.rankLevel}>
          {formatLevelWithStripes(promotion.levelName, promotion.stripes)}
        </Text>
        {promotion.awardedByName ? (
          <Text style={styles.rankAwardedBy}>
            Присвоил: {promotion.awardedByName}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    rankBlock: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
    },
    rankRows: { flex: 1, gap: theme.spacing(2) },
    rankRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
    },
    rankSwatch: {
      width: 56,
      height: 28,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    rankStripes: {
      flexDirection: "row",
      gap: 3,
    },
    rankStripe: {
      width: 4,
      height: 14,
      borderRadius: 1,
    },
    rankLadder: { ...theme.typography.label },
    rankLevel: { fontSize: 15, fontWeight: "600", color: theme.colors.text },
    rankAwardedBy: { ...theme.typography.caption, color: theme.colors.muted },
    actionChev: {
      fontSize: 20,
      color: theme.colors.mutedFaint,
      lineHeight: 20,
    },
  })
