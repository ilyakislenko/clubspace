import React from "react"
import { Image, Pressable, StyleSheet, Text, View } from "react-native"

import { theme } from "../../shared/theme"

type NavVideo = { id: string; title: string; thumbnailUrl?: string | null }

type Props = {
  videos: NavVideo[]
  currentIndex: number
  prevId: string | null
  nextId: string | null
  onNavigate: (videoId: string, title?: string) => void
}

export function VideoCourseNav({
  videos,
  currentIndex,
  prevId,
  nextId,
  onNavigate,
}: Props) {
  const next = nextId ? videos[currentIndex + 1] : null

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
              <Text style={styles.upNextThumbPlaceholder}>
                №{currentIndex + 2}
              </Text>
            )}
          </View>
          <View style={styles.upNextBody}>
            <Text style={styles.upNextLabel}>Следующее</Text>
            <Text style={styles.upNextTitle} numberOfLines={2}>
              {next.title}
            </Text>
          </View>
          <Text style={styles.upNextArrow}>→</Text>
        </Pressable>
      )}

      {(prevId || nextId) && (
        <View style={styles.navRow}>
          <Pressable
            disabled={!prevId}
            onPress={() =>
              prevId && onNavigate(prevId, videos[currentIndex - 1]?.title)
            }
            style={({ pressed }) => [
              styles.navButton,
              !prevId && styles.navButtonDisabled,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.navText}>← Предыдущее</Text>
          </Pressable>
          <Pressable
            disabled={!nextId}
            onPress={() =>
              nextId && onNavigate(nextId, videos[currentIndex + 1]?.title)
            }
            style={({ pressed }) => [
              styles.navButton,
              !nextId && styles.navButtonDisabled,
              pressed && styles.buttonPressed,
            ]}
          >
            <Text style={styles.navText}>Следующее →</Text>
          </Pressable>
        </View>
      )}
    </>
  )
}

const styles = StyleSheet.create({
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
  upNextLabel: { ...theme.typography.label },
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
  navRow: {
    flexDirection: "row",
    gap: theme.spacing(2),
    marginTop: theme.spacing(2),
  },
  navButton: {
    flex: 1,
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  navButtonDisabled: { opacity: 0.4 },
  navText: { fontSize: 13, color: theme.colors.text },
  buttonPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
})
