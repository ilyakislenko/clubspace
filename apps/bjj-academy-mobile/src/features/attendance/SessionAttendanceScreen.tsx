import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import {
  createAttendanceSession,
  getSessionRoster,
  markAttendance,
  unmarkAttendance,
  type SessionRoster,
} from "../../shared/api/attendance"
import { useAuth } from "../../shared/auth-context"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"

type Props = NativeStackScreenProps<RootStackParamList, "SessionAttendance">

export function SessionAttendanceScreen({ route }: Props) {
  const { slotId, sessionDate, groupName } = route.params
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [roster, setRoster] = useState<SessionRoster | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!workspace) return
    setError(null)
    try {
      // Resolve-or-create the session for this occurrence, then load its roster.
      const session = await createAttendanceSession({
        workspaceId: workspace.workspaceId,
        data: { kind: "scheduled", slotId, sessionDate },
      })
      setSessionId(session.id)
      const r = await getSessionRoster({
        workspaceId: workspace.workspaceId,
        sessionId: session.id,
      })
      setRoster(r)
    } catch (err) {
      setError(errorMessage(err, "Не удалось открыть занятие"))
    }
  }, [workspace, slotId, sessionDate])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (userId: string, present: boolean) => {
    if (!workspace || !sessionId || busy) return
    setBusy(true)
    try {
      const updated = present
        ? await unmarkAttendance({
            workspaceId: workspace.workspaceId,
            sessionId,
            userId,
          })
        : await markAttendance({
            workspaceId: workspace.workspaceId,
            sessionId,
            userIds: [userId],
          })
      setRoster(updated)
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить отметку"))
    } finally {
      setBusy(false)
    }
  }

  const markAll = async () => {
    if (!workspace || !sessionId || !roster || busy) return
    const absent = roster.roster.filter((e) => !e.present).map((e) => e.userId)
    if (absent.length === 0) return
    setBusy(true)
    try {
      const updated = await markAttendance({
        workspaceId: workspace.workspaceId,
        sessionId,
        userIds: absent,
      })
      setRoster(updated)
    } catch (err) {
      setError(errorMessage(err, "Не удалось отметить всех"))
    } finally {
      setBusy(false)
    }
  }

  if (!workspace) return null

  const presentCount = roster?.roster.filter((e) => e.present).length ?? 0

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.body}>
        <View>
          <Text style={styles.title}>{groupName ?? "Отметка посещаемости"}</Text>
          <Text style={styles.subtitle}>
            {sessionDate}
            {roster ? ` · отмечено ${presentCount} из ${roster.roster.length}` : ""}
          </Text>
        </View>

        {error && <ErrorRetry message={error} onRetry={() => void load()} />}

        {!roster && !error ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : roster ? (
          <>
            <Pressable
              style={({ pressed }) => [
                styles.markAll,
                pressed && styles.pressed,
              ]}
              onPress={() => void markAll()}
              disabled={busy}
            >
              <Text style={styles.markAllText}>Отметить всех</Text>
            </Pressable>

            {roster.roster.length === 0 ? (
              <Text style={styles.empty}>В группе пока нет участников.</Text>
            ) : (
              <View style={styles.rows}>
                {roster.roster.map((e) => (
                  <Pressable
                    key={e.userId}
                    style={({ pressed }) => [
                      styles.row,
                      e.present && styles.rowPresent,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => void toggle(e.userId, e.present)}
                    disabled={busy}
                  >
                    <View
                      style={[
                        styles.check,
                        e.present && styles.checkOn,
                      ]}
                    >
                      {e.present && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                    <Text style={styles.name} numberOfLines={1}>
                      {e.displayName}
                      {e.isGuest ? " · гость" : ""}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    center: { paddingVertical: theme.spacing(6), alignItems: "center" },
    body: { padding: theme.spacing(5), gap: theme.spacing(3) },
    title: { ...theme.typography.title, fontSize: 22, color: theme.colors.text },
    subtitle: {
      ...theme.typography.body,
      color: theme.colors.muted,
      marginTop: theme.spacing(1),
    },
    markAll: {
      alignSelf: "flex-start",
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
    },
    markAllText: {
      color: theme.colors.accentText,
      fontWeight: "700",
      fontSize: 14,
    },
    pressed: { opacity: 0.7 },
    empty: { color: theme.colors.muted, fontSize: 13 },
    rows: { gap: theme.spacing(1) },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    rowPresent: { borderColor: theme.colors.accent },
    check: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: theme.colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    checkOn: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    checkMark: { color: theme.colors.accentText, fontSize: 14, fontWeight: "700" },
    name: { flex: 1, color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  })
