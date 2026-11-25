import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import {
  getMyClubMessage,
  markClubMessageRead,
  type MyClubMessage,
} from "../../shared/api/messages"
import { useAuth } from "../../shared/auth-context"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { Pressable } from "../../shared/components/Pressable"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { messageByline } from "./club-messages"

type Props = NativeStackScreenProps<RootStackParamList, "ClubMessage">

/**
 * One message from the club. Opening it is «открыли» for the sender: the
 * first open stamps the row read (the child's row in a child's profile).
 * There are no replies — «Связаться с клубом» leads to the club's contacts.
 */
export function ClubMessageScreen({ navigation, route }: Props) {
  const { messageId } = route.params
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace, actingAs } = useAuth()
  const workspaceId = workspace?.workspaceId
  const [message, setMessage] = useState<MyClubMessage | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!workspaceId) return
    setError(null)
    try {
      const m = await getMyClubMessage({ workspaceId, messageId })
      setMessage(m)
      // The stamp is best-effort: the text is on screen either way, and the
      // next open retries it.
      if (m.readAt === null) {
        void markClubMessageRead({ workspaceId, messageId })
          .then(setMessage)
          .catch(() => undefined)
      }
    } catch (e) {
      setError(errorMessage(e, "Не удалось открыть сообщение"))
    }
  }, [workspaceId, messageId])

  useEffect(() => {
    void load()
  }, [load])

  if (!workspace) return null

  if (!message) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        {error ? (
          <ErrorRetry message={error} onRetry={() => void load()} />
        ) : (
          <ActivityIndicator color={theme.colors.accent} />
        )}
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <ScrollView contentContainerStyle={styles.body}>
          {/* Opened from a child's notification, the app is in the child's
              profile: say whose message this is. */}
          {actingAs ? (
            <Text style={styles.forChild}>Профиль: {actingAs.firstname}</Text>
          ) : null}
          <Text style={styles.title} accessibilityRole="header">
            {message.title}
          </Text>
          <Text style={styles.byline}>{messageByline(message, new Date())}</Text>
          <Text style={styles.text} selectable>
            {message.body}
          </Text>
          <View style={styles.footer}>
            <Pressable
              onPress={() => navigation.navigate("ClubAbout")}
              accessibilityRole="link"
              hitSlop={8}
            >
              <Text style={styles.link}>Связаться с клубом</Text>
            </Pressable>
          </View>
        </ScrollView>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.background,
    },
    body: { padding: theme.spacing(5), gap: theme.spacing(2) },
    forChild: { ...theme.typography.caption, color: theme.colors.muted },
    title: { ...theme.typography.heading, color: theme.colors.text },
    byline: { fontSize: 13, color: theme.colors.muted },
    text: {
      fontSize: 16,
      lineHeight: 23,
      color: theme.colors.text,
      marginTop: theme.spacing(2),
    },
    footer: { marginTop: theme.spacing(4), alignItems: "flex-start" },
    link: { fontSize: 15, fontWeight: "600", color: theme.colors.accent },
  })
