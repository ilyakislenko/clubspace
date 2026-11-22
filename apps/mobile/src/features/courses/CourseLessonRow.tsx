import React from "react"
import { Image, StyleSheet, Text, View } from "react-native"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"

import { type CourseVideo } from "../../shared/api/courses"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import { formatVideoDuration } from "../../shared/format-video-duration"
import { LockBadge } from "./LockBadge"

type Props = {
  video: CourseVideo
  /** The title as shown in the course (without the course name). */
  title: string
  /** The lesson's place in the course, 1-based. */
  number: number
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
  title,
  number,
  offline,
  progress,
  showChapterHeader,
  onPress,
  onToggleWatched,
}: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const ready = video.status === "ready"
  const duration = formatVideoDuration(video.duration)
  const lock = video.lock ?? null
  const watched = progress?.status === "watched"
  const inProgress =
    progress?.status === "in-progress" && progress.ratio > 0
  const meta = [duration, ready ? null : "в обработке"]
    .filter(Boolean)
    .join(" · ")

  return (
    <View>
      {showChapterHeader && (
        <Text style={styles.chapterHeader} accessibilityRole="header">
          {video.chapterTitle}
        </Text>
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
        accessibilityLabel={`Урок ${number}: ${title}${
          watched ? ", просмотрено" : ""
        }${offline ? ", скачано" : ""}${
          !ready && !offline ? ", обрабатывается" : ""
        }${lock ? `, закрыт: ${lock.reason}` : ""}`}
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
            <Text style={styles.thumbPlaceholder}>{number}</Text>
          )}
          {watched && (
            <View style={styles.watchedMark}>
              <Icon name="checkmark" size={12} color={theme.colors.onOverlay} />
            </View>
          )}
          {inProgress && (
            <View style={styles.thumbProgressTrack}>
              <View
                style={[
                  styles.thumbProgressFill,
                  { width: `${Math.round(progress.ratio * 100)}%` },
                ]}
              />
            </View>
          )}
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {title}
          </Text>
          {(meta || offline) && (
            <View style={styles.rowMetaLine}>
              {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
              {offline && (
                <Icon
                  name="arrow-down-circle"
                  size={14}
                  color={theme.colors.success}
                />
              )}
            </View>
          )}
          {lock && <LockBadge reason={lock.reason} />}
        </View>
      </Pressable>
    </View>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  chapterHeader: {
    fontSize: 15,
    fontWeight: "700",
    color: theme.colors.text,
    marginTop: theme.spacing(4),
    marginBottom: theme.spacing(1),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(3),
    paddingVertical: theme.spacing(2),
  },
  rowDisabled: { opacity: 0.5 },
  rowPressed: { opacity: 0.7 },
  thumb: {
    width: 100,
    height: 64,
    backgroundColor: theme.colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.sm,
    overflow: "hidden",
  },
  thumbImage: { width: "100%", height: "100%" },
  thumbPlaceholder: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.colors.mutedFaint,
  },
  watchedMark: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.success,
  },
  thumbProgressTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: theme.colors.overlaySoft,
  },
  thumbProgressFill: {
    height: 3,
    backgroundColor: theme.colors.accent,
  },
  rowBody: {
    flex: 1,
    justifyContent: "center",
    gap: 4,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.text,
  },
  rowMetaLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing(2),
  },
  rowMeta: { fontSize: 12, color: theme.colors.muted },
})
