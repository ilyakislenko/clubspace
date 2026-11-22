// The menus of «Сравнить рядом», each a `Sheet`: the speed of both sides, the
// both-sides options («⋯» in the bottom bar) and one side's tools («⋯» on a
// pane). A choice applies and closes the menu.
import React from "react"
import { StyleSheet, Text, View } from "react-native"

import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import { Sheet } from "../../shared/components/Sheet"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { formatPosition } from "../video/format-position"
import { COMPARE_RATES, type CompareSide, type Segment } from "./compare-sync"

/** One menu choice: a label, an optional second line, ticked when on. */
function OptionRow({
  label,
  detail,
  role,
  selected = false,
  disabled = false,
  onPress,
}: {
  label: string
  detail?: string
  role: "radio" | "switch" | "button"
  selected?: boolean
  disabled?: boolean
  onPress: () => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={role}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={
        role === "button" ? { disabled } : { checked: selected, disabled }
      }
      style={[styles.row, disabled && styles.disabled]}
    >
      <View style={styles.text}>
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      </View>
      {selected && <Icon name="checkmark" size={20} color={theme.colors.accent} />}
    </Pressable>
  )
}

export function CompareSpeedSheet({
  rate,
  onSelect,
  onClose,
}: {
  rate: number
  onSelect: (rate: number) => void
  onClose: () => void
}) {
  return (
    <Sheet title="Скорость" onClose={onClose}>
      {COMPARE_RATES.map((option) => (
        <OptionRow
          key={option}
          role="radio"
          label={option === 1 ? "1x · обычная" : `${option}x`}
          selected={option === rate}
          onPress={() => onSelect(option)}
        />
      ))}
    </Sheet>
  )
}

export function CompareOptionsSheet({
  sync,
  canSync,
  leftLoopLeads,
  audioSide,
  onToggleSync,
  onAudioSide,
  onClose,
}: {
  sync: boolean
  // Locking needs a video on both sides.
  canSync: boolean
  // Locked, the left A–B loop drives both sides.
  leftLoopLeads: boolean
  audioSide: CompareSide
  onToggleSync: () => void
  onAudioSide: (side: CompareSide) => void
  onClose: () => void
}) {
  return (
    <Sheet title="Обе стороны" onClose={onClose}>
      <OptionRow
        role="switch"
        label="Синхронно"
        detail={
          !canSync
            ? "Сначала выберите видео справа"
            : sync && leftLoopLeads
              ? "A–B слева ведёт обе стороны"
              : undefined
        }
        selected={sync}
        disabled={!canSync}
        onPress={onToggleSync}
      />
      <OptionRow
        role="radio"
        label="Звук слева"
        selected={audioSide === "left"}
        onPress={() => onAudioSide("left")}
      />
      <OptionRow
        role="radio"
        label="Звук справа"
        selected={audioSide === "right"}
        onPress={() => onAudioSide("right")}
      />
    </Sheet>
  )
}

export function ComparePaneSheet({
  label,
  mirrored,
  loop,
  onToggleMirror,
  onSetA,
  onSetB,
  onClearLoop,
  onClose,
}: {
  label: string
  mirrored: boolean
  loop: Segment | null
  onToggleMirror: () => void
  onSetA: () => void
  onSetB: () => void
  onClearLoop: () => void
  onClose: () => void
}) {
  return (
    <Sheet title={label} onClose={onClose}>
      <OptionRow
        role="switch"
        label="Зеркально"
        selected={mirrored}
        onPress={onToggleMirror}
      />
      <OptionRow
        role="button"
        label="Отметить точку A"
        detail={loop ? formatPosition(loop.startSec) : undefined}
        onPress={onSetA}
      />
      <OptionRow
        role="button"
        label="Отметить точку B"
        detail={loop?.endSec != null ? formatPosition(loop.endSec) : undefined}
        onPress={onSetB}
      />
      {loop && <OptionRow role="button" label="Сбросить A–B" onPress={onClearLoop} />}
    </Sheet>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      minHeight: 48,
      paddingVertical: theme.spacing(2),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    text: { flex: 1 },
    label: { ...theme.typography.body, color: theme.colors.text },
    detail: { ...theme.typography.caption, color: theme.colors.muted },
    disabled: { opacity: 0.5 },
  })
