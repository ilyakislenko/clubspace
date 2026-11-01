import React from "react"
import { Image, StyleSheet, Text, View } from "react-native"
import { Pressable } from "../../shared/components/Pressable"

import { type CourseVideo } from "../../shared/api/courses"
import { useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { formatVideoDuration } from "../../shared/format-video-duration"
import { LockBadge } from "./LockBadge"

const isNewVideo = (createdAt?: string): boolean => {
  if (!createdAt) return false
  const ageMs = Date.now() - new Date(createdAt).getTime()
  return ageMs < 7 * 24 * 60 * 60 * 1000
}

type Props = {
  video: CourseVideo
  index: number
  offline: boolean
  progress?: { status: string; ratio: number } | null
  showChapterHeader: boolean
  // A locked lesson still calls onPress (the screen explains the lock).
  onPress: () => void
  // Undefined = no "mark watched" long-press (locked lesson, or a course with
  // locked progression where only really watching a lesson counts).
  onToggleWatched?: () => void
}

export function CourseLessonRow({
  video,
  index,
  offline,
  progress,
  showChapterHeader,
  onPress,
  onToggleWatched,
}: Props) {
  const styles = useThemedStyles(makeStyles)
  const ready = video.status === "ready"
  const duration = formatVideoDuration(video.duration)
  const lock = video.lock ?? null
  const isNew = isNewVideo(
    (video as unknown as { createdAt?: string }).createdAt,
  )

  return (
    <View>
      {showChapterHeader && (
        <View style={styles.chapterHeader}>
          <Text style={styles.chapterHeaderText}>{video.chapterTitle}</Text>
        </View>
      )}
      <Pressable
        onPress={() => {
          if (!ready && !offline) return
          onPress()
        }}
        onLongPress={onToggleWatched}
        delayLongPress={400}
        disabled={!ready && !offline}
        accessibilityRole="button"
        accessibilityLabel={`${video.title}${
          progress?.status === "watched" ? ", просмотрено" : ""
        }${!ready && !offline ? ", обрабатывается" : ""}${
          lock ? `, закрыт: ${lock.reason}` : ""
        }`}
        accessibilityHint={
          onToggleWatched
            ? "Открыть урок. Удержание — отметить просмотренным."
            : "Открыть урок."
        }
        accessibilityState={{ disabled: !ready && !offline }}
        style={({ pressed }) => [
          styles.row,
          (lock || (!ready && !offline)) && styles.rowDisabled,
          pressed && (ready || offline) && styles.rowPressed,
        ]}
      >
        <View style={styles.thumb}>
          {video.thumbnailUrl ? (
            <Image
              source={{ uri: video.thumbnailUrl }}
              style={styles.thumbImage}
              resizeMode="cover"
            />
          ) : (
            <Text style={styles.thumbPlaceholder}>№{index + 1}</Text>
          )}
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {video.title}
            </Text>
            {progress?.status === "watched" && (
              <Text style={styles.watchedMark}>✓</Text>
            )}
            {offline && <Text style={styles.offlineDot}>●</Text>}
          </View>
          <View style={styles.rowMetaLine}>
            <Text style={styles.rowMeta}>
              Урок {index + 1}
              {duration ? ` · ${duration}` : ""}
              {!ready ? " · в обработке" : ""}
            </Text>
            {isNew && <Text style={styles.newBadge}>Новое</Text>}
          </View>
          {lock && <LockBadge reason={lock.reason} />}
        </View>
        {progress &&
          progress.status === "in-progress" &&
          progress.ratio > 0 && (
            <View style={styles.rowProgressTrack}>
              <View
                style={[
                  styles.rowProgressFill,
                  { width: `${Math.round(progress.ratio * 100)}%` },
                ]}
              />
            </View>
          )}
      </Pressable>
    </View>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  chapterHeader: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(1),
  },
  chapterHeaderText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: theme.colors.muted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    marginBottom: theme.spacing(2),
    position: "relative",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowDisabled: { opacity: 0.5 },
  rowPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  thumb: {
    width: 100,
    height: 64,
    backgroundColor: theme.colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
    margin: theme.spacing(2),
    borderRadius: theme.radius.sm,
    overflow: "hidden",
  },
  thumbImage: { width: "100%", height: "100%" },
  thumbPlaceholder: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.colors.mutedFaint,
  },
  rowBody: {
    flex: 1,
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(3),
    justifyContent: "center",
    gap: 4,
  },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  rowTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.text,
  },
  offlineDot: {
    fontSize: 10,
    color: theme.colors.success,
  },
  watchedMark: {
    fontSize: 14,
    color: theme.colors.success,
    fontWeight: "800",
  },
  rowMetaLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
    flexWrap: "wrap",
  },
  rowMeta: { fontSize: 12, color: theme.colors.muted },
  newBadge: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
    color: theme.colors.accentText,
    backgroundColor: theme.colors.accent,
    paddingHorizontal: theme.spacing(2),
    paddingVertical: 2,
    borderRadius: theme.radius.full,
    overflow: "hidden",
  },
  rowProgressTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: "transparent",
  },
  rowProgressFill: {
    height: 2,
    backgroundColor: theme.colors.accent,
  },
})
