import { StyleSheet, Text, View } from "react-native"

import type { Theme } from "../theme"
import { useThemedStyles } from "../theme-context"

type Props = {
  message?: string
}

/**
 * Slim banner shown when a screen is displaying cached data because the latest
 * revalidation failed (usually offline). Non-blocking — the cached content
 * still renders below it.
 *
 * Themed at runtime like every other surface: it used to build its styles from
 * the static default theme, so on any of the other eleven themes — dark ones
 * especially — it rendered as a light-grey card in the middle of a dark screen.
 */
export function OfflineNotice({
  message = "Нет сети — показаны сохранённые данные",
}: Props) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.text}>{message}</Text>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
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
