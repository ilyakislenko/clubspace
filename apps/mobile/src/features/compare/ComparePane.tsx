// One side of «Сравнить рядом»: the picture, its title (tap to pick another
// clip), its own seek bar and frame step; mirror and A–B sit behind its «⋯».
// Purely presentational — CompareScreen owns both players and every timing
// rule (sync, loops), so the two sides stay in one place.
import React, { type ComponentType } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { PlayerChapter } from "../video/ChapterDrawer"
import { formatPosition } from "../video/format-position"
import { SeekBar } from "../video/PlayerOverlay"
import type { PlayerSurfaceProps } from "../video/player-types"
import type { Segment } from "./compare-sync"

export type PaneMedia =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready"
      title: string
      chapters: readonly PlayerChapter[]
      // Playing the downloaded copy.
      offline: boolean
    }

type Props = {
  label: string
  // The picked clip's title: shown while it loads or after it failed, so the
  // side can still be re-picked; the loaded video's own title wins.
  clipTitle: string | undefined
  media: PaneMedia
  PlayerSurface: ComponentType<PlayerSurfaceProps>
  time: number
  duration: number | undefined
  mirrored: boolean
  audible: boolean
  loop: Segment | null
  onPick: () => void
  onScrub: (time: number | null) => void
  onSeek: (time: number) => void
  onStepFrame: (direction: 1 | -1) => void
  // This side's tools: mirror, A–B.
  onMore: () => void
}

export function ComparePane({
  label,
  clipTitle,
  media,
  PlayerSurface,
  time,
  duration,
  mirrored,
  audible,
  loop,
  onPick,
  onScrub,
  onSeek,
  onStepFrame,
  onMore,
}: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const ready = media.status === "ready"
  const picked = media.status !== "empty"
  const title = (ready ? media.title : clipTitle) || "Видео"

  return (
    <View style={styles.pane}>
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        {picked && (
          <Pressable
            onPress={onPick}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${title}. Выбрать другое видео`}
            hitSlop={6}
            style={styles.titleButton}
          >
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Icon name="chevron-down" size={14} color={theme.colors.onOverlay} />
          </Pressable>
        )}
        {ready && media.offline && <Text style={styles.badge}>загружено</Text>}
        {!audible && ready && (
          <Icon name="volume-mute" size={16} color={theme.colors.onOverlay} />
        )}
      </View>

      <View style={styles.picture}>
        {ready ? (
          <PlayerSurface
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            mirrored={mirrored}
          />
        ) : media.status === "loading" ? (
          <ActivityIndicator color={theme.colors.onOverlay} />
        ) : media.status === "error" ? (
          <Text style={styles.message}>{media.message}</Text>
        ) : (
          <Pressable onPress={onPick} style={styles.placeholder}>
            <Icon name="add-circle-outline" size={32} color={theme.colors.onOverlay} />
            <Text style={styles.message}>Выберите, с чем сравнить</Text>
          </Pressable>
        )}
      </View>

      {ready && (
        <View style={styles.controls}>
          <SeekBar
            time={time}
            duration={duration}
            loopA={loop?.startSec ?? null}
            loopB={loop?.endSec ?? null}
            chapters={media.chapters}
            onScrub={onScrub}
            onSeek={onSeek}
          />
          <View style={styles.row}>
            <Text style={styles.time}>
              {formatPosition(time)}
              {duration ? ` / ${formatPosition(duration)}` : ""}
            </Text>
            <View style={styles.spacer} />
            <IconAction icon="chevron-back" label={`${label}: кадр назад`} onPress={() => onStepFrame(-1)} />
            <IconAction icon="chevron-forward" label={`${label}: кадр вперёд`} onPress={() => onStepFrame(1)} />
            <IconAction icon="ellipsis-horizontal" label="Ещё" onPress={onMore} />
          </View>
        </View>
      )}
    </View>
  )
}

export function SmallButton({
  label,
  accessibilityLabel,
  onPress,
  active = false,
  disabled = false,
}: {
  label: string
  accessibilityLabel?: string
  onPress: () => void
  active?: boolean
  disabled?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: active, disabled }}
      hitSlop={4}
      style={[styles.chip, active && styles.active, disabled && styles.disabled]}
    >
      <Text style={[styles.chipText, active && styles.activeText]}>{label}</Text>
    </Pressable>
  )
}

export function IconAction({
  icon,
  label,
  onPress,
  active = false,
}: {
  icon: React.ComponentProps<typeof Icon>["name"]
  label: string
  onPress: () => void
  active?: boolean
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityState={active ? { selected: true } : undefined}
      hitSlop={6}
      style={[styles.iconButton, active && styles.active]}
    >
      <Icon
        name={icon}
        size={20}
        color={active ? theme.colors.accentText : theme.colors.onOverlay}
      />
    </Pressable>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    pane: { flex: 1, minWidth: 0, minHeight: 0 },
    head: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      paddingHorizontal: theme.spacing(2),
      paddingVertical: theme.spacing(1),
    },
    label: {
      color: theme.colors.onOverlay,
      fontSize: 12,
      fontWeight: "700",
      opacity: 0.7,
    },
    titleButton: {
      flex: 1,
      minWidth: 0,
      minHeight: 36,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1),
    },
    title: {
      flexShrink: 1,
      color: theme.colors.onOverlay,
      fontSize: 13,
      fontWeight: "600",
    },
    badge: { color: theme.colors.onOverlay, fontSize: 11, opacity: 0.7 },
    picture: {
      flex: 1,
      minHeight: 80,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.playerBg,
    },
    placeholder: { alignItems: "center", gap: theme.spacing(2) },
    message: {
      color: theme.colors.onOverlay,
      fontSize: 13,
      textAlign: "center",
      paddingHorizontal: theme.spacing(4),
    },
    controls: { paddingHorizontal: theme.spacing(2) },
    row: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: theme.spacing(1) + 2,
      paddingBottom: theme.spacing(1),
    },
    time: {
      color: theme.colors.onOverlay,
      fontSize: 12,
      fontVariant: ["tabular-nums"],
    },
    spacer: { flex: 1 },
    iconButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.overlayStrong,
    },
    chip: {
      minHeight: 30,
      paddingHorizontal: theme.spacing(2) + 2,
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.onOverlay,
      alignItems: "center",
      justifyContent: "center",
    },
    chipText: {
      color: theme.colors.onOverlay,
      fontSize: 12,
      fontWeight: "700",
      fontVariant: ["tabular-nums"],
    },
    active: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    activeText: { color: theme.colors.accentText },
    disabled: { opacity: 0.4 },
  })
