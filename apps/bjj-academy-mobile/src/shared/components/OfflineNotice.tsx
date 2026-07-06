import { StyleSheet, Text, View } from "react-native"

import { theme } from "../theme"

type Props = {
  message?: string
}

/**
 * Slim banner shown when a screen is displaying cached data because the latest
 * revalidation failed (usually offline). Non-blocking — the cached content
 * still renders below it.
 */
export function OfflineNotice({
  message = "Нет сети — показаны сохранённые данные",
}: Props) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.text}>{message}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceMuted,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  text: {
    color: theme.colors.muted,
    fontSize: 12,
    textAlign: "center",
  },
})
