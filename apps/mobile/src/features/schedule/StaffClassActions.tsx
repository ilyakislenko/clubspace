import { cap } from "@clubspace/ui-kit/brand"
import React, { useState } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import {
  approveClassSubstitution,
  cancelClassSubstitution,
  createClassSubstitution,
  declineClassSubstitution,
  listSubstituteCandidates,
  type SubstituteCandidate,
} from "../../shared/api/class-substitutions"
import type { ScheduleSession } from "../../shared/api/groups"
import { showAlert } from "../../shared/alert"
import { useAuth } from "../../shared/auth-context"
import { useVocabulary } from "../../shared/use-vocabulary"
import { Pressable } from "../../shared/components/Pressable"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import { haptics } from "../../shared/haptics"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useResponsive } from "../../shared/useResponsive"
import { formatTimeInTz } from "./club-schedule-buckets"
import { personName } from "./schedule-calendar"
import type { SubstitutionAction } from "./substitution-helpers"

/**
 * The staff half of a class sheet: «Назначить замену» (with a coach picker),
 * «Взять занятие», approve / decline a coach's request, withdraw or cancel.
 * Every action calls `onChanged` so the schedule (and this sheet) refresh.
 */
export function StaffClassActions({
  session,
  actions,
  onChanged,
}: {
  session: ScheduleSession
  actions: SubstitutionAction[]
  onChanged: () => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  // On a tablet the coaches go two to a row: eleven in one column pushed
  // «Отмена» below a landscape window.
  const twoUp = useResponsive().sizeClass !== "compact"
  const { workspace } = useAuth()
  const { coach } = useVocabulary()
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<SubstituteCandidate[] | null>(
    null,
  )
  const [pickerOpen, setPickerOpen] = useState(false)

  if (!workspace || actions.length === 0) return null
  const workspaceId = workspace.workspaceId
  const sub = session.substitution ?? null
  const sessionDate = formatTimeInTz(session.startAt, session.timezone).dateKey

  const run = async (
    action: () => Promise<unknown>,
    done: string,
    failure: string,
  ) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
      haptics.success()
      showToast(done, "success")
      setPickerOpen(false)
      onChanged()
    } catch (e) {
      setError(errorMessage(e, failure))
    } finally {
      setBusy(false)
    }
  }

  const openPicker = async () => {
    setPickerOpen(true)
    if (candidates) return
    try {
      setCandidates(await listSubstituteCandidates({ workspaceId }))
    } catch (e) {
      setError(errorMessage(e, `Не удалось загрузить ${coach.genPl}`))
    }
  }

  const assign = (substituteId: string) =>
    void run(
      () =>
        createClassSubstitution({
          workspaceId,
          slotId: session.slotId,
          sessionDate,
          substituteId,
        }),
      "Замена назначена",
      "Не удалось назначить замену",
    )

  const take = () =>
    showAlert(
      "Взять занятие?",
      `${cap(coach.nom)} группы получит запрос. Отмечать посещаемость можно будет, когда он даст добро.`,
      [
        { text: "Нет", style: "cancel" },
        {
          text: "Отправить запрос",
          onPress: () =>
            void run(
              () =>
                createClassSubstitution({
                  workspaceId,
                  slotId: session.slotId,
                  sessionDate,
                }),
              `Запрос отправлен ${coach.dat} группы`,
              "Не удалось отправить запрос",
            ),
        },
      ],
    )

  const withId = (fn: typeof approveClassSubstitution) => () =>
    sub ? fn({ workspaceId, substitutionId: sub.id }) : Promise.resolve()

  const confirmCancel = () =>
    showAlert(
      "Отменить замену?",
      `Занятие снова проведёт ${coach.nom} группы; записавшиеся получат уведомление.`,
      [
        { text: "Нет", style: "cancel" },
        {
          text: "Отменить замену",
          style: "destructive",
          onPress: () =>
            void run(
              withId(cancelClassSubstitution),
              "Замена отменена",
              "Не удалось отменить замену",
            ),
        },
      ],
    )

  // The group's coach and the current substitute can't be picked.
  const pickable = (candidates ?? []).filter(
    (c) => c.id !== session.group.coach.id && c.id !== sub?.substitute.id,
  )

  const button = (
    key: string,
    label: string,
    onPress: () => void,
    tone: "primary" | "secondary" | "danger" = "secondary",
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={[
        styles.button,
        tone === "primary" ? styles.buttonPrimary : styles.buttonSecondary,
      ]}
    >
      <Text
        style={
          tone === "primary"
            ? styles.buttonPrimaryText
            : tone === "danger"
              ? styles.buttonDangerText
              : styles.buttonSecondaryText
        }
      >
        {label}
      </Text>
    </Pressable>
  )

  return (
    <View style={styles.wrap}>
      {sub?.status === "PENDING" && actions.includes("approve") && (
        <Text style={styles.muted}>
          {personName(sub.substitute)} хочет провести это занятие. Пока вы не
          дадите добро, отмечать посещаемость он не может.
        </Text>
      )}
      {sub?.status === "PENDING" && actions.includes("withdraw") && (
        <Text style={styles.muted}>
          Запрос отправлен — ждём, когда {coach.nom} группы даст добро.
        </Text>
      )}
      {error && <Text style={styles.danger}>{error}</Text>}
      {busy && <ActivityIndicator color={theme.colors.accent} />}

      {actions.includes("approve") &&
        button(
          "approve",
          "Дать добро",
          () =>
            void run(
              withId(approveClassSubstitution),
              "Замена одобрена",
              "Не удалось одобрить замену",
            ),
          "primary",
        )}
      {actions.includes("decline") &&
        button(
          "decline",
          "Отклонить запрос",
          () =>
            void run(
              withId(declineClassSubstitution),
              "Запрос отклонён",
              "Не удалось отклонить запрос",
            ),
          "danger",
        )}
      {actions.includes("take") && button("take", "Взять занятие", take)}
      {actions.includes("withdraw") &&
        button("withdraw", "Отозвать запрос", () =>
          void run(
            withId(cancelClassSubstitution),
            "Запрос отозван",
            "Не удалось отозвать запрос",
          ),
        )}
      {actions.includes("assign") &&
        !pickerOpen &&
        button(
          "assign",
          sub?.status === "APPROVED" ? "Сменить замену" : "Назначить замену",
          () => void openPicker(),
        )}
      {pickerOpen && (
        <View style={styles.picker}>
          <Text style={styles.pickerTitle}>Кто проведёт занятие</Text>
          {candidates === null && !error && (
            <ActivityIndicator color={theme.colors.accent} />
          )}
          {candidates !== null && pickable.length === 0 && (
            <Text style={styles.muted}>Других {coach.genPl} в клубе нет.</Text>
          )}
          <View style={twoUp && styles.pickerGrid}>
            {pickable.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => assign(c.id)}
                disabled={busy}
                accessibilityRole="button"
                style={[styles.pickerRow, twoUp && styles.pickerCell]}
              >
                <Text style={styles.pickerRowText}>{personName(c)}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => setPickerOpen(false)}
            accessibilityRole="button"
            style={styles.pickerRow}
          >
            <Text style={styles.muted}>Отмена</Text>
          </Pressable>
        </View>
      )}
      {actions.includes("cancel") &&
        button("cancel", "Отменить замену", confirmCancel, "danger")}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    wrap: { gap: theme.spacing(3) },
    muted: { fontSize: 13, color: theme.colors.muted, lineHeight: 18 },
    danger: { fontSize: 13, color: theme.colors.danger },
    button: {
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonSecondary: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    buttonSecondaryText: {
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "600",
    },
    buttonDangerText: {
      color: theme.colors.danger,
      fontSize: 15,
      fontWeight: "600",
    },
    buttonPrimary: { backgroundColor: theme.colors.accent },
    buttonPrimaryText: {
      color: theme.colors.accentText,
      fontSize: 15,
      fontWeight: "700",
    },
    picker: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      paddingVertical: theme.spacing(1),
    },
    pickerTitle: {
      fontSize: 12,
      fontWeight: "700",
      color: theme.colors.muted,
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2),
      textTransform: "uppercase",
    },
    pickerRow: {
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(3),
    },
    pickerGrid: { flexDirection: "row", flexWrap: "wrap" },
    pickerCell: { width: "50%" },
    pickerRowText: { fontSize: 15, color: theme.colors.text },
  })
