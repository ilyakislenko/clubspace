import React, { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"

import { showAlert } from "../../shared/alert"
import {
  cancelOrgEventRegistration,
  listOrgEventStudents,
  registerForOrgEvent,
  type OrgEventStudent,
} from "../../shared/api/organizations"
import { choiceA11y } from "../../shared/choice-a11y"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import { Sheet, useSheetAction } from "../../shared/components/Sheet"
import { TextInput } from "../../shared/components/TextInput"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import { haptics } from "../../shared/haptics"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { filterStudentsByName, STUDENT_SEARCH_THRESHOLD, studentRowState } from "./org-helpers"

/**
 * «Записать учеников»: the coach's students (their own groups) with who is
 * booked, with a name search once the list is long. A row tap books a student
 * who consented to the federation, or cancels a booking this coach may cancel
 * (made through the club by them, or their own); a booking made by someone
 * else stays inert; one who has not consented reads «нет согласия» and can't
 * be booked. `onChanged` after every change (the card's places).
 */
export function OrgEventStudentsSheet({
  workspaceId,
  eventId,
  title,
  onChanged,
  onClosed,
}: {
  workspaceId: string
  eventId: string
  title: string
  onChanged: () => void
  onClosed: () => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { showToast } = useToast()
  const sheet = useSheetAction({ initiallyOpen: true, onClosed })
  const [students, setStudents] = useState<OrgEventStudent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const shown = students ? filterStudentsByName(students, query) : []

  const load = useCallback(async () => {
    setError(null)
    try {
      setStudents(await listOrgEventStudents({ workspaceId, eventId }))
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить учеников"))
    }
  }, [workspaceId, eventId])
  useEffect(() => {
    void load()
  }, [load])

  const change = async (s: OrgEventStudent, action: () => Promise<unknown>, done: string) => {
    setBusyId(s.userId)
    try {
      await action()
      haptics.light()
      showToast(done, "success")
      onChanged()
      await load()
    } catch (e) {
      showToast(errorMessage(e, "Не удалось сохранить запись"), "error")
    } finally {
      setBusyId(null)
    }
  }

  const onRow = (s: OrgEventStudent) => {
    const state = studentRowState(s)
    if (state === "noConsent" || state === "bookedLocked" || busyId) return
    if (state === "available" || !s.registration) {
      void change(s, () => registerForOrgEvent({ workspaceId, eventId, userId: s.userId }), `${s.name} — в списке участников`)
      return
    }
    const registrationId = s.registration.id
    showAlert("Отменить запись?", s.name, [
      { text: "Нет", style: "cancel" },
      {
        text: "Отменить запись",
        style: "destructive",
        onPress: () =>
          void change(s, () => cancelOrgEventRegistration({ workspaceId, registrationId }), "Запись отменена"),
      },
    ])
  }

  return (
    <Sheet title="Записать учеников" {...sheet.sheetProps}>
      <View style={styles.body}>
        <Text style={styles.event} numberOfLines={2}>
          {title}
        </Text>
        {error && !students ? (
          <ErrorRetry message={error} onRetry={() => void load()} />
        ) : !students ? (
          <ActivityIndicator color={theme.colors.accent} />
        ) : students.length === 0 ? (
          <Text style={styles.muted}>В ваших группах нет учеников</Text>
        ) : (
          <>
            {students.length > STUDENT_SEARCH_THRESHOLD && (
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Поиск по имени"
                placeholderTextColor={theme.colors.muted}
                style={styles.search}
                autoCorrect={false}
                returnKeyType="search"
                accessibilityLabel="Поиск по имени"
              />
            )}
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {shown.length === 0 && <Text style={styles.muted}>Никого не нашли</Text>}
              {shown.map((s) => {
                const state = studentRowState(s)
                const inert = state === "noConsent" || state === "bookedLocked"
                const booked = state === "booked" || state === "bookedLocked"
                return (
                  <Pressable
                    key={s.userId}
                    onPress={() => onRow(s)}
                    disabled={inert}
                    {...choiceA11y("checkbox", booked, { disabled: inert })}
                    style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  >
                    <Text style={[styles.name, state === "noConsent" && styles.muted]} numberOfLines={1}>
                      {s.name}
                    </Text>
                    {busyId === s.userId ? (
                      <ActivityIndicator size="small" color={theme.colors.accent} />
                    ) : booked ? (
                      <Icon name="checkmark-circle" size={22} color={theme.colors.success} />
                    ) : state === "noConsent" ? (
                      <Text style={styles.hint}>нет согласия</Text>
                    ) : (
                      <Icon name="add-circle-outline" size={22} color={theme.colors.accent} />
                    )}
                  </Pressable>
                )
              })}
            </ScrollView>
          </>
        )}
        {students?.some((s) => !s.consented) && (
          <Text style={styles.hint}>
            Записать можно тех, кто разрешил федерации видеть свой пояс — в приложении, в настройках клуба.
          </Text>
        )}
      </View>
    </Sheet>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    body: { gap: theme.spacing(3) },
    event: { ...theme.typography.bodyStrong, color: theme.colors.text },
    search: {
      height: 44,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing(4),
      fontSize: 15,
      color: theme.colors.text,
      backgroundColor: theme.colors.surfaceMuted,
    },
    list: { maxHeight: 420 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: theme.spacing(3),
      minHeight: 48,
      paddingVertical: theme.spacing(2),
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    name: { flex: 1, fontSize: 15, color: theme.colors.text },
    muted: { color: theme.colors.muted },
    hint: { fontSize: 12, color: theme.colors.muted },
    pressed: { opacity: 0.85 },
  })
