// The menus of «Сравнить рядом», each a `Sheet`: the speed of both sides, the
// both-sides options («⋯» in the bottom bar) and one side's tools («⋯» on a
// pane). A choice applies at once (an A/B mark lands on the moment of the
// tap) and closes the menu; `onClose` fires once it's gone (`useSheetAction`).
import React from "react"
import { StyleSheet, Text, View } from "react-native"

import { choiceA11y } from "../../shared/choice-a11y"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import { Sheet, useSheetAction } from "../../shared/components/Sheet"
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
      {...(role === "radio"
        ? choiceA11y("radio", selected, { disabled })
        : {
            accessibilityRole: role,
            accessibilityState: role === "button" ? { disabled } : { checked: selected, disabled },
          })}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
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
  const sheet = useSheetAction({ initiallyOpen: true, onClosed: onClose })
  return (
    <Sheet title="Скорость" {...sheet.sheetProps}>
      {COMPARE_RATES.map((option) => (
        <OptionRow
          key={option}
          role="radio"
          label={option === 1 ? "1x · обычная" : `${option}x`}
          selected={option === rate}
          onPress={() => sheet.apply(() => onSelect(option))}
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
  const sheet = useSheetAction({ initiallyOpen: true, onClosed: onClose })
  return (
    <Sheet title="Обе стороны" {...sheet.sheetProps}>
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
        onPress={() => sheet.apply(onToggleSync)}
      />
      <OptionRow
        role="radio"
        label="Звук слева"
        selected={audioSide === "left"}
        onPress={() => sheet.apply(() => onAudioSide("left"))}
      />
      <OptionRow
        role="radio"
        label="Звук справа"
        selected={audioSide === "right"}
        onPress={() => sheet.apply(() => onAudioSide("right"))}
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
  const sheet = useSheetAction({ initiallyOpen: true, onClosed: onClose })
  return (
    <Sheet title={label} {...sheet.sheetProps}>
      <OptionRow
        role="switch"
        label="Зеркально"
        selected={mirrored}
        onPress={() => sheet.apply(onToggleMirror)}
      />
      <OptionRow
        role="button"
        label="Отметить точку A"
        detail={loop ? formatPosition(loop.startSec) : undefined}
        onPress={() => sheet.apply(onSetA)}
      />
      <OptionRow
        role="button"
        label="Отметить точку B"
        detail={loop?.endSec != null ? formatPosition(loop.endSec) : undefined}
        onPress={() => sheet.apply(onSetB)}
      />
      {loop && (
        <OptionRow
          role="button"
          label="Сбросить A–B"
          onPress={() => sheet.apply(onClearLoop)}
        />
      )}
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
