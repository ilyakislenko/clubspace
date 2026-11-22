import React from "react"
import { Image, StyleSheet, Text, View } from "react-native"

import type { VideoReviewSummary } from "../../shared/api/video-reviews"
import { PlayGlyph } from "../../shared/components/PlayGlyph"
import { Pressable } from "../../shared/components/Pressable"
import { pluralRu } from "../../shared/format-ru"
import type { Theme } from "../../shared/theme"
import { useThemedStyles } from "../../shared/theme-context"
import { useVocabulary } from "../../shared/use-vocabulary"
import { formatPosition } from "../video/format-position"
import { reviewStatusLabel } from "./review-helpers"

// One request in «Мои разборы» / «Разборы учеников»: cover, title, status.
export function ReviewListItem({
  item,
  showMember,
  onPress,
}: {
  item: VideoReviewSummary
  // Staff lists name the member.
  showMember: boolean
  onPress: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  const vocabulary = useVocabulary()
  const status = reviewStatusLabel(item.status, vocabulary)
  const highlighted = item.status === (showMember ? "open" : "answered")
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${status}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {item.clip.thumbnailUrl ? (
        <Image source={{ uri: item.clip.thumbnailUrl }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbPlaceholder]}>
          <PlayGlyph />
        </View>
      )}
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        {showMember && (
          <Text style={styles.muted} numberOfLines={1}>
            {item.member.name}
          </Text>
        )}
        <View style={styles.metaRow}>
          <View style={[styles.status, highlighted && styles.statusHighlighted]}>
            <Text style={[styles.statusText, highlighted && styles.statusTextHighlighted]}>
              {status}
            </Text>
          </View>
          {item.commentCount > 0 && (
            <Text style={styles.muted}>
              {item.commentCount}{" "}
              {pluralRu(item.commentCount, "комментарий", "комментария", "комментариев")}
            </Text>
          )}
          {item.clip.duration != null && (
            <Text style={styles.muted}>{formatPosition(item.clip.duration)}</Text>
          )}
        </View>
      </View>
    </Pressable>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      padding: theme.spacing(3),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    pressed: { opacity: 0.85 },
    thumb: {
      width: 100,
      height: 60,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceMuted,
    },
    thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    text: { flex: 1, gap: 4 },
    title: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
    muted: { fontSize: 12, color: theme.colors.muted },
    metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: theme.spacing(2) },
    status: {
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 2,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.surfaceMuted,
    },
    statusHighlighted: { backgroundColor: theme.colors.accentSoft },
    statusText: { fontSize: 12, fontWeight: "600", color: theme.colors.textSecondary },
    statusTextHighlighted: { color: theme.colors.accent },
  })
