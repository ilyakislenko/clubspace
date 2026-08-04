import { StyleSheet, Text, View } from "react-native"
import { Pressable } from "./Pressable"

import { theme } from "../theme"

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
 */
export function ErrorRetry({
  message,
  onRetry,
  retryLabel = "Повторить",
}: Props) {
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

const styles = StyleSheet.create({
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
    backgroundColor: theme.colors.text,
  },
  buttonPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  buttonText: {
    color: theme.colors.accentText,
    fontSize: 14,
    fontWeight: "600",
  },
})
