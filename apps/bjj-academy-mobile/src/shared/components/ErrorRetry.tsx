import { StyleSheet, Text, View } from "react-native"
import { Pressable } from "./Pressable"

import type { Theme } from "../theme"
import { useThemedStyles } from "../theme-context"

type Props = {
  message: string
  onRetry: () => void
  retryLabel?: string
}

/**
 * Standard "something failed — try again" block: a centered danger message
 * with a pill retry button. Matches the inline pattern the course screens
 * already used, so every list screen now fails the same, discoverable way
 * instead of leaving the user with a dead-end error line.
 *
 * Themed at runtime: it used to build its styles from the static default
 * theme, so the retry button on every list screen kept light-theme colours on
 * all eleven other themes.
 */
export function ErrorRetry({
  message,
  onRetry,
  retryLabel = "Повторить",
}: Props) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel={retryLabel}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      >
        <Text style={styles.buttonText}>{retryLabel}</Text>
      </Pressable>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing(4),
      paddingHorizontal: theme.spacing(8),
      paddingVertical: theme.spacing(10),
    },
    message: {
      color: theme.colors.danger,
      fontSize: 14,
      textAlign: "center",
    },
    button: {
      paddingHorizontal: theme.spacing(5),
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.full,
      // The accent, not `text`: a retry is an action, and on a dark theme a
      // `text`-coloured pill is a near-white slab in the middle of the screen.
      backgroundColor: theme.colors.accent,
    },
    buttonPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
    buttonText: {
      color: theme.colors.accentText,
      fontSize: 14,
      fontWeight: "600",
    },
  })
