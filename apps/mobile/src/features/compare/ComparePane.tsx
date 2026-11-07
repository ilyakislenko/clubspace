// One side of «Сравнить рядом»: the picture, its own seek bar, frame step,
// mirror and A–B. Purely presentational — CompareScreen owns both players and
// every timing rule (sync, loops), so the two sides stay in one place.
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
  onToggleMirror: () => void
  onSetA: () => void
  onSetB: () => void
  onClearLoop: () => void
}

export function ComparePane({
  label,
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
  onToggleMirror,
  onSetA,
  onSetB,
  onClearLoop,
}: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const ready = media.status === "ready"

  return (
    <View style={styles.pane}>
      <View style={styles.head}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.title} numberOfLines={1}>
          {ready ? media.title : ""}
        </Text>
        {ready && media.offline && <Text style={styles.badge}>загружено</Text>}
        {!audible && ready && (
          <Icon name="volume-mute" size={16} color={theme.colors.onOverlay} />
        )}
        <SmallButton label="Выбрать" accessibilityLabel={`${label}: выбрать видео`} onPress={onPick} />
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
            <IconAction
              icon="swap-horizontal"
              label={mirrored ? `${label}: отключить зеркало` : `${label}: зеркально`}
              active={mirrored}
              onPress={onToggleMirror}
            />
            <SmallButton
              label={loop ? `A ${formatPosition(loop.startSec)}` : "A"}
              accessibilityLabel={`${label}: отметить точку A`}
              active={!!loop}
              onPress={onSetA}
            />
            <SmallButton
              label={loop?.endSec != null ? `B ${formatPosition(loop.endSec)}` : "B"}
              accessibilityLabel={`${label}: отметить точку B`}
              active={loop?.endSec != null}
              onPress={onSetB}
            />
            {loop && (
              <IconAction
                icon="close-circle-outline"
                label={`${label}: сбросить A–B`}
                onPress={onClearLoop}
              />
            )}
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
    title: {
      flex: 1,
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
