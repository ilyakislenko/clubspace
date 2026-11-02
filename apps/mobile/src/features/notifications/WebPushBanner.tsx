import React, { useEffect, useState } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import { kvGet, kvSet } from "../../shared/kv"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useVocabulary } from "../../shared/use-vocabulary"
import { IOS_INSTALL_HINT, useWebPush } from "./useWebPush"

// Dismissed once → never again on this browser; Settings still has the switch.
const DISMISSED_KEY = "clubspace.webPushBannerDismissed"

/**
 * Home, browser build: a soft ask to turn notifications on. The browser's own
 * prompt only appears after the member taps «Включить» (a prompt on page load
 * is blocked or buried by browsers). On an iPhone outside the installed app it
 * explains how to install instead. Renders nothing otherwise.
 */
export function WebPushBanner() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const vocabulary = useVocabulary()
  const { state, busy, enable } = useWebPush()
  const [dismissed, setDismissed] = useState<boolean | null>(null)

  useEffect(() => {
    void kvGet(DISMISSED_KEY)
      .then((v) => setDismissed(Boolean(v)))
      .catch(() => setDismissed(false))
  }, [])

  if (dismissed !== false) return null
  if (state !== "available" && state !== "ios-needs-install") return null

  const dismiss = () => {
    setDismissed(true)
    void kvSet(DISMISSED_KEY, "1").catch(() => undefined)
  }
  const ios = state === "ios-needs-install"

  return (
    <View style={styles.banner}>
      <Icon
        name="notifications-outline"
        size={22}
        color={theme.colors.accent}
      />
      <View style={styles.text}>
        <Text style={styles.title}>
          {ios ? "Уведомления на iPhone" : "Включите уведомления"}
        </Text>
        <Text style={styles.hint}>
          {ios
            ? IOS_INSTALL_HINT
            : `Сообщим о переносе ${vocabulary.session.gen}, объявлениях клуба и абонементе.`}
        </Text>
        {!ios && (
          <Pressable
            onPress={() => void enable()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Включить уведомления"
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={theme.colors.accentText} />
            ) : (
              <Text style={styles.buttonText}>Включить</Text>
            )}
          </Pressable>
        )}
      </View>
      <Pressable
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Скрыть"
        hitSlop={8}
      >
        <Icon name="close" size={20} color={theme.colors.textSecondary} />
      </Pressable>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    banner: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing(3),
      padding: theme.spacing(4),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.accentSoft,
    },
    text: { flex: 1, gap: 4 },
    title: { ...theme.typography.bodyStrong, color: theme.colors.text },
    hint: { fontSize: 13, color: theme.colors.textSecondary },
    button: {
      alignSelf: "flex-start",
      marginTop: theme.spacing(2),
      paddingVertical: theme.spacing(2),
      paddingHorizontal: theme.spacing(4),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
      minWidth: 96,
      alignItems: "center",
    },
    buttonText: { ...theme.typography.bodyStrong, color: theme.colors.accentText },
    pressed: { opacity: 0.85 },
  })
