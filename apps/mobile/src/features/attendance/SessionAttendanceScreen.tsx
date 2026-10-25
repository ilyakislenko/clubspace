import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { TextInput } from "../../shared/components/TextInput"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import {
  createAttendanceSession,
  getAttendanceSession,
  getSessionRoster,
  markAttendance,
  unmarkAttendance,
  updateSession,
  type AttendanceSession,
  type SessionRoster,
} from "../../shared/api/attendance"
import { useAuth } from "../../shared/auth-context"
import { subscribeInvalidation } from "../../shared/cache/cache-events"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { KeyboardAvoidingContainer } from "../../shared/components/KeyboardAvoidingContainer"
import { errorMessage } from "../../shared/error-message"
import { isOnline } from "../offline/network-policy"
import { enqueue } from "../../shared/outbox/outbox"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useKeepFocusedInputVisible } from "../../shared/use-keep-focused-input-visible"
import { formatSessionStart } from "../schedule/schedule-helpers"
import { splitRoster } from "./roster-helpers"

// One screen for both ways in: a group class (slot + date, resolved or
// created) and a personal session (opened by its id).
type Props = NativeStackScreenProps<
  RootStackParamList,
  "SessionAttendance" | "SessionRoster"
>

export function SessionAttendanceScreen({ route }: Props) {
  const params = route.params
  const openedId = "sessionId" in params ? params.sessionId : null
  const slotId = "slotId" in params ? params.slotId : null
  const sessionDate = "sessionDate" in params ? params.sessionDate : null
  const groupName = "groupName" in params ? params.groupName : undefined
  const title = "title" in params ? params.title : undefined
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const scrollRef = useRef<ScrollView>(null)
  const keyboardScroll = useKeepFocusedInputVisible(scrollRef)
  const { workspace } = useAuth()

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [session, setSession] = useState<AttendanceSession | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [roster, setRoster] = useState<SessionRoster | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Coach's note on the session; `savedNotes` tracks what's persisted so the
  // Save button only lights up when there are unsaved edits.
  const [notes, setNotes] = useState("")
  const [savedNotes, setSavedNotes] = useState("")
  const [savingNotes, setSavingNotes] = useState(false)
  // Set when a mark was queued offline — it'll sync on reconnect.
  const [offlineNote, setOfflineNote] = useState(false)

  const recordsUrl = (sid: string) =>
    `/workspaces/${workspace?.workspaceId}/attendance/sessions/${sid}/records`

  // Optimistically flip the given users to `present` in the local roster.
  const setPresence = (userIds: string[], present: boolean) =>
    setRoster((r) =>
      r
        ? {
            ...r,
            roster: r.roster.map((e) =>
              userIds.includes(e.userId) ? { ...e, present } : e,
            ),
            expected: r.expected?.map((g) =>
              userIds.includes(g.userId) ? { ...g, present } : g,
            ),
          }
        : r,
    )

  const load = useCallback(async () => {
    if (!workspace) return
    setError(null)
    try {
      // Resolve-or-create the session for this occurrence, then load its roster.
      const created = openedId
        ? await getAttendanceSession({
            workspaceId: workspace.workspaceId,
            sessionId: openedId,
          })
        : await createAttendanceSession({
            workspaceId: workspace.workspaceId,
            data: { kind: "scheduled", slotId: slotId!, sessionDate: sessionDate! },
          })
      setSession(created)
      setSessionId(created.id)
      setNotes(created.notes ?? "")
      setSavedNotes(created.notes ?? "")
      const r = await getSessionRoster({
        workspaceId: workspace.workspaceId,
        sessionId: created.id,
      })
      setRoster(r)
    } catch (err) {
      setError(errorMessage(err, "Не удалось открыть занятие"))
    }
  }, [workspace, openedId, slotId, sessionDate])

  useEffect(() => {
    void load()
  }, [load])

  // Roster only (never the notes, which the coach may be mid-edit on): used by
  // pull-to-refresh and realtime, so students' self check-ins show up live.
  const refreshRoster = useCallback(async () => {
    if (!workspace || !sessionId) return
    try {
      setRoster(
        await getSessionRoster({
          workspaceId: workspace.workspaceId,
          sessionId,
        }),
      )
    } catch {
      // Keep the roster on screen; the next refresh retries.
    }
  }, [workspace, sessionId])

  useEffect(() => {
    if (!workspace || !sessionId) return
    return subscribeInvalidation(`attendance:${workspace.workspaceId}`, () => {
      void refreshRoster()
    })
  }, [workspace, sessionId, refreshRoster])

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshRoster()
    } finally {
      setRefreshing(false)
    }
  }

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
      setError(null)
    } catch (err) {
      if (await isOnline()) {
        setError(errorMessage(err, "Не удалось сохранить отметку"))
        return
      }
      // Offline: flip locally + queue the write for replay on reconnect.
      setPresence([userId], !present)
      await enqueue(
        present
          ? {
              label: "Снять отметку",
              method: "delete",
              url: `${recordsUrl(sessionId)}/${userId}`,
            }
          : {
              label: "Отметить",
              method: "post",
              url: recordsUrl(sessionId),
              data: { userIds: [userId] },
            },
      )
      setOfflineNote(true)
      setError(null)
    } finally {
      setBusy(false)
    }
  }

  const markAll = async () => {
    if (!workspace || !sessionId || !roster || busy) return
    // Own members only: marking a guest charges their abonement.
    const absent = splitRoster(roster).markAllIds
    if (absent.length === 0) return
    setBusy(true)
    try {
      const updated = await markAttendance({
        workspaceId: workspace.workspaceId,
        sessionId,
        userIds: absent,
      })
      setRoster(updated)
      setError(null)
    } catch (err) {
      if (await isOnline()) {
        setError(errorMessage(err, "Не удалось отметить всех"))
        return
      }
      setPresence(absent, true)
      await enqueue({
        label: "Отметить всех",
        method: "post",
        url: recordsUrl(sessionId),
        data: { userIds: absent },
      })
      setOfflineNote(true)
      setError(null)
    } finally {
      setBusy(false)
    }
  }

  const saveNotes = async () => {
    if (!workspace || !sessionId || savingNotes) return
    setSavingNotes(true)
    try {
      const trimmed = notes.trim()
      const updated = await updateSession({
        workspaceId: workspace.workspaceId,
        sessionId,
        notes: trimmed ? trimmed : null,
      })
      const next = updated.notes ?? ""
      setNotes(next)
      setSavedNotes(next)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить заметку"))
    } finally {
      setSavingNotes(false)
    }
  }

  if (!workspace) return null

  const split = roster ? splitRoster(roster) : null
  // One member, paid for off-app: nothing to mark in bulk, no pack to run out.
  const isPersonal = roster?.kind === "personal"
  const notesDirty = notes !== savedNotes

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
      {/* Padding on Android too: edge-to-edge doesn't resize for the keyboard. */}
      <KeyboardAvoidingContainer
        style={styles.flex}
      >
      <ScrollView
        ref={scrollRef}
        {...keyboardScroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={theme.colors.accent}
          />
        }
      >
        <View>
          <Text style={styles.title}>{groupName ?? title ?? "Отметка посещаемости"}</Text>
          <Text style={styles.subtitle}>
            {session
              ? formatSessionStart(session.startAt, session.timezone)
              : (sessionDate ?? "")}
            {split ? ` · отмечено ${split.presentCount} из ${split.total}` : ""}
          </Text>
        </View>

        {roster?.checkInCode && (
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>
              Код самоотметки — назовите его группе
            </Text>
            <Text style={styles.codeValue}>{roster.checkInCode}</Text>
          </View>
        )}

        {sessionId && (
          <View style={styles.notesCard}>
            <Text style={styles.notesLabel}>Заметка к занятию</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Например: разбор прохода гарда, аттестация"
              placeholderTextColor={theme.colors.muted}
              multiline
              maxLength={2000}
              style={styles.notesInput}
            />
            {notesDirty && (
              <Pressable
                style={({ pressed }) => [
                  styles.notesSave,
                  pressed && styles.pressed,
                ]}
                onPress={() => void saveNotes()}
                disabled={savingNotes}
              >
                <Text style={styles.notesSaveText}>
                  {savingNotes ? "Сохраняем…" : "Сохранить заметку"}
                </Text>
              </Pressable>
            )}
          </View>
        )}

        {error && <ErrorRetry message={error} onRetry={() => void load()} />}

        {offlineNote && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>
              Нет сети — отметки сохранены и отправятся автоматически, когда
              появится подключение.
            </Text>
          </View>
        )}

        {!roster && !error ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : roster && split ? (
          <>
            {!isPersonal && split.markAllIds.length > 0 && (
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
            )}

            {split.expected.length > 0 && (
              <View style={styles.rows}>
                <Text style={styles.sectionTitle}>
                  {isPersonal ? "Ученик" : "Записались"}
                </Text>
                {split.expected.map((g) => (
                  <Pressable
                    key={g.userId}
                    style={({ pressed }) => [
                      styles.row,
                      g.present && styles.rowPresent,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => void toggle(g.userId, g.present)}
                    disabled={busy}
                  >
                    <View
                      style={[styles.check, g.present && styles.checkOn]}
                    >
                      {g.present && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                    <Text style={styles.name} numberOfLines={1}>
                      {g.displayName}
                      {g.frozenUntil ? " · заморожен" : ""}
                      {!isPersonal && g.classesLeft === 0 && (
                        <Text style={styles.noClasses}>
                          {" · занятий не осталось"}
                        </Text>
                      )}
                    </Text>
                    {!isPersonal && <Text style={styles.guestPill}>гость</Text>}
                  </Pressable>
                ))}
              </View>
            )}

            {split.main.length === 0 && split.expected.length === 0 ? (
              isPersonal ? null : (
                <Text style={styles.empty}>В группе пока нет участников.</Text>
              )
            ) : split.main.length === 0 ? null : (
              <View style={styles.rows}>
                {split.main.map((e) => (
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
                      {e.frozenUntil ? " · заморожен" : ""}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
      </KeyboardAvoidingContainer>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    flex: { flex: 1 },
    center: { paddingVertical: theme.spacing(6), alignItems: "center" },
    offlineBanner: {
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceMuted,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    offlineText: { color: theme.colors.muted, fontSize: 13, lineHeight: 18 },
    body: { padding: theme.spacing(5), gap: theme.spacing(3) },
    title: { ...theme.typography.title, fontSize: 22, color: theme.colors.text },
    subtitle: {
      ...theme.typography.body,
      color: theme.colors.muted,
      marginTop: theme.spacing(1),
    },
    codeCard: {
      marginTop: theme.spacing(3),
      padding: theme.spacing(4),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.accentSoft,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: "center",
      gap: theme.spacing(1),
    },
    codeLabel: { ...theme.typography.label, color: theme.colors.muted },
    codeValue: {
      fontSize: 32,
      fontWeight: "800",
      letterSpacing: 6,
      color: theme.colors.accent,
    },
    notesCard: {
      padding: theme.spacing(4),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: theme.spacing(2),
    },
    notesLabel: { ...theme.typography.label, color: theme.colors.muted },
    notesInput: {
      minHeight: 64,
      // Grows to ~7 lines, then scrolls inside, so the caret never slips
      // under the keyboard on a short (landscape) screen.
      maxHeight: 160,
      color: theme.colors.text,
      fontSize: 15,
      textAlignVertical: "top",
      padding: 0,
    },
    notesSave: {
      alignSelf: "flex-start",
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
    },
    notesSaveText: {
      color: theme.colors.accentText,
      fontWeight: "700",
      fontSize: 14,
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
    sectionTitle: { ...theme.typography.label, color: theme.colors.muted },
    guestPill: {
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 2,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accentSoft,
      color: theme.colors.accent,
      fontSize: 11,
      fontWeight: "700",
      overflow: "hidden",
    },
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
    noClasses: { color: theme.colors.danger, fontWeight: "500" },
  })
