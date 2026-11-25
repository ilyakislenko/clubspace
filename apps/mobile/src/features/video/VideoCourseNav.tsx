import React from "react"
import { Image, StyleSheet, Text, View } from "react-native"
import { Pressable } from "../../shared/components/Pressable"

import { useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"

/** A lesson to go to; `number` is its 1-based place in the course. */
export type NavLesson = {
  id: string
  title: string
  thumbnailUrl?: string | null
  number: number
}

type Props = {
  prev: NavLesson | null
  next: NavLesson | null
  onNavigate: (videoId: string, title?: string) => void
}

// The course around the lesson: the next one as a card (the way on), the
// previous as a quiet link.
export function VideoCourseNav({ prev, next, onNavigate }: Props) {
  const styles = useThemedStyles(makeStyles)

  return (
    <>
      {next && (
        <Pressable
          onPress={() => onNavigate(next.id, next.title)}
          style={({ pressed }) => [
            styles.upNextCard,
            pressed && styles.buttonPressed,
          ]}
        >
          <View style={styles.upNextThumb}>
            {next.thumbnailUrl ? (
              <Image
                source={{ uri: next.thumbnailUrl ?? undefined }}
                style={styles.upNextImage}
                resizeMode="cover"
              />
            ) : (
              <Text style={styles.upNextThumbPlaceholder}>№{next.number}</Text>
            )}
          </View>
          <View style={styles.upNextBody}>
            <Text style={styles.upNextLabel}>Следующий урок</Text>
            <Text style={styles.upNextTitle} numberOfLines={2}>
              {next.title}
            </Text>
          </View>
          <Text style={styles.upNextArrow}>→</Text>
        </Pressable>
      )}

      {prev && (
        <Pressable
          onPress={() => onNavigate(prev.id, prev.title)}
          accessibilityRole="button"
          style={styles.prevLink}
        >
          <Text style={styles.prevText}>← Предыдущий урок</Text>
        </Pressable>
      )}
    </>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  upNextCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
    padding: theme.spacing(3),
    paddingRight: theme.spacing(4),
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.sm,
  },
  upNextThumb: {
    width: 88,
    height: 56,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  upNextImage: { width: "100%", height: "100%" },
  upNextThumbPlaceholder: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.colors.mutedFaint,
  },
  upNextBody: { flex: 1, gap: 2 },
  upNextLabel: { ...theme.typography.caption },
  upNextTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.text,
  },
  upNextArrow: {
    fontSize: 18,
    color: theme.colors.muted,
    fontWeight: "700",
  },
  prevLink: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
  prevText: { fontSize: 14, color: theme.colors.textSecondary },
  buttonPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
})
