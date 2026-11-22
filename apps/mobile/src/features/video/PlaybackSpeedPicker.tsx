import React from "react"
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { PLAYBACK_RATES } from "./player-math"

export type PlayerChoice<T> = { value: T; label: string; accessibilityLabel?: string }

type ChoiceProps<T> = {
  choices: ReadonlyArray<PlayerChoice<T>>
  selected: T
  onSelect: (value: T) => void
  style?: StyleProp<ViewStyle>
}

/**
 * A single-choice list in a small floating card, the current one ticked: the
 * player's speed and subtitle popovers. The caller positions it (the player
 * overlay places it absolutely above its button).
 */
export function PlayerChoicePopover<T>({
  choices,
  selected,
  onSelect,
  style,
}: ChoiceProps<T>) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={[styles.popover, style]}>
      <ScrollView>
        <View style={styles.list} accessibilityRole="radiogroup">
          {choices.map((choice) => {
            const isSelected = choice.value === selected
            return (
              <Pressable
                key={choice.label}
                onPress={() => onSelect(choice.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={choice.accessibilityLabel ?? choice.label}
                style={({ pressed }) => [
                  styles.option,
                  isSelected && styles.optionSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[styles.optionText, isSelected && styles.optionTextSelected]}
                >
                  {choice.label}
                </Text>
                {isSelected && (
                  <Icon name="checkmark" size={18} color={theme.colors.accent} />
                )}
              </Pressable>
            )
          })}
        </View>
      </ScrollView>
    </View>
  )
}

const RATE_CHOICES: ReadonlyArray<PlayerChoice<number>> = PLAYBACK_RATES.map(
  (rate) => ({
    value: rate,
    label: rate === 1 ? "1x · обычная" : `${rate}x`,
    accessibilityLabel: `${rate}x`,
  }),
)

/** The speed choices in the player's popover. */
export function PlaybackRatePopover({
  rate,
  onSelect,
  style,
}: {
  rate: number
  onSelect: (rate: number) => void
  style?: StyleProp<ViewStyle>
}) {
  return (
    <PlayerChoicePopover
      choices={RATE_CHOICES}
      selected={rate}
      onSelect={onSelect}
      style={style}
    />
  )
}

const POPOVER_WIDTH = 200

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    list: { gap: theme.spacing(1) },
    option: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2) + 2,
      borderRadius: theme.radius.md,
    },
    optionSelected: { backgroundColor: theme.colors.surfaceMuted },
    pressed: { opacity: 0.7 },
    optionText: { fontSize: 15, color: theme.colors.text },
    optionTextSelected: { fontWeight: "700" },
    popover: {
      width: POPOVER_WIDTH,
      padding: theme.spacing(2),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surfaceElevated,
      ...theme.shadows.sm,
    },
  })
