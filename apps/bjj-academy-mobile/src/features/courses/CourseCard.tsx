import React from "react"
import { Image, StyleSheet, Text, View } from "react-native"
import { Pressable } from "../../shared/components/Pressable"

import { type CourseSummary } from "../../shared/api/courses"
import { HighlightedText } from "../../shared/components/HighlightedText"
import { useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"

type Props = {
  course: CourseSummary
  query: string
  pinned: boolean
  onPress: () => void
  onLongPress: () => void
}

export function CourseCard({
  course,
  query,
  pinned,
  onPress,
  onLongPress,
}: Props) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      accessibilityRole="button"
      accessibilityLabel={`Курс: ${course.title}${
        pinned ? ", закреплён" : ""
      }`}
      accessibilityHint="Открыть курс. Удержание — закрепить или открепить."
      style={({ pressed }) => [
        styles.card,
        pinned && styles.cardPinned,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.thumb}>
        {course.thumbnailUrl ? (
          <Image
            source={{ uri: course.thumbnailUrl }}
            style={styles.thumbImage}
            resizeMode="cover"
          />
        ) : (
          <Text style={styles.thumbPlaceholder}>Нет превью</Text>
        )}
      </View>
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          {pinned && (
            <Text
              style={styles.pinBadge}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              // react-native-web ignores the two RN props above; without this
              // the card button announces a bare "📌" before its title.
              aria-hidden
            >
              📌
            </Text>
          )}
          <View style={{ flex: 1 }}>
            <HighlightedText
              text={course.title}
              query={query}
              style={styles.cardTitle}
              highlightStyle={styles.cardTitleHighlight}
              numberOfLines={2}
            />
          </View>
        </View>
        {course.description && (
          <HighlightedText
            text={course.description}
            query={query}
            style={styles.cardDesc}
            highlightStyle={styles.cardDescHighlight}
            numberOfLines={2}
          />
        )}
        {course.tags?.length > 0 && (
          <View style={styles.tagRow}>
            {course.tags.slice(0, 3).map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing(3),
    ...theme.shadows.sm,
  },
  cardPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  cardPinned: {
    borderColor: theme.colors.accent,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  pinBadge: {
    fontSize: 12,
  },
  thumb: {
    width: 128,
    height: 80,
    backgroundColor: theme.colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
    margin: theme.spacing(2),
    borderRadius: theme.radius.sm,
    overflow: "hidden",
  },
  thumbImage: { width: "100%", height: "100%" },
  thumbPlaceholder: { fontSize: 11, color: theme.colors.mutedFaint },
  cardBody: {
    flex: 1,
    padding: theme.spacing(4),
    paddingLeft: theme.spacing(3),
    gap: theme.spacing(1),
    justifyContent: "center",
  },
  cardTitle: {
    ...theme.typography.subheading,
    color: theme.colors.text,
  },
  cardTitleHighlight: {
    color: theme.colors.accent,
    backgroundColor: theme.colors.accentSoft,
  },
  cardDesc: {
    ...theme.typography.caption,
    color: theme.colors.muted,
  },
  cardDescHighlight: {
    color: theme.colors.text,
    backgroundColor: theme.colors.accentSoft,
  },
  tagRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
    marginTop: 4,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceMuted,
  },
  tagText: { fontSize: 11, color: theme.colors.muted, fontWeight: "600" },
})
