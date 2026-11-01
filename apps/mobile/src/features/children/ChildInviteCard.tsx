import React, { useState } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import { showAlert } from "../../shared/alert"
import {
  confirmMyDependent,
  unlinkMyDependent,
  type DependentRelation,
  type MyDependent,
} from "../../shared/api/dependents"
import { Pressable } from "../../shared/components/Pressable"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { ConsentCheckbox, RelationPicker } from "./ChildFormParts"
import { dependentName, formatBirthDate } from "./children-helpers"

/**
 * A club added a child and named this guardian: confirm with consent, or
 * decline. `onDone` reloads the lists once the invitation is answered.
 */
export function ChildInviteCard({
  invite,
  onDone,
}: {
  invite: MyDependent
  onDone: () => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { showToast } = useToast()
  const [consent, setConsent] = useState(false)
  const [relation, setRelation] = useState<DependentRelation>(invite.relation)
  const [busy, setBusy] = useState<"confirm" | "decline" | null>(null)
  const name = dependentName(invite)
  const club = invite.invitedBy?.name ?? invite.clubs[0]?.name

  const confirm = async () => {
    if (busy || !consent) return
    setBusy("confirm")
    try {
      await confirmMyDependent({
        dependentId: invite.id,
        data: { relation, consent: true },
      })
      showToast(`${name} — в списке ваших детей`, "success")
      onDone()
    } catch (error) {
      showToast(errorMessage(error, "Не удалось подтвердить"), "error")
      setBusy(null)
    }
  }

  const decline = () =>
    showAlert(
      "Отклонить приглашение?",
      `Вы не будете указаны родителем ребёнка ${name}${club ? ` в клубе «${club}»` : ""}.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Отклонить",
          style: "destructive",
          onPress: async () => {
            setBusy("decline")
            try {
              await unlinkMyDependent(invite.id)
              showToast("Приглашение отклонено")
              onDone()
            } catch (error) {
              showToast(errorMessage(error, "Не удалось отклонить"), "error")
              setBusy(null)
            }
          },
        },
      ],
    )

  return (
    <View style={styles.card}>
      <Text style={styles.chip}>Приглашение от клуба</Text>
      <Text style={styles.name}>{name}</Text>
      <Text style={styles.text}>
        {club ? `Клуб «${club}» добавил ребёнка` : "Клуб добавил ребёнка"} и
        указал вас родителем.
        {invite.dateOfBirth
          ? ` Дата рождения: ${formatBirthDate(invite.dateOfBirth)}.`
          : ""}{" "}
        Подтвердите, чтобы видеть его расписание, абонемент и отмечать на
        тренировках.
      </Text>
      <RelationPicker value={relation} onChange={setRelation} />
      <ConsentCheckbox checked={consent} onChange={setConsent} />
      <View style={styles.actions}>
        <Pressable
          onPress={decline}
          disabled={busy !== null}
          accessibilityRole="button"
          style={[styles.button, styles.secondary]}
        >
          {busy === "decline" ? (
            <ActivityIndicator color={theme.colors.text} />
          ) : (
            <Text style={styles.secondaryText}>Отклонить</Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => void confirm()}
          disabled={busy !== null || !consent}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy !== null || !consent }}
          style={[styles.button, styles.primary, !consent && styles.disabled]}
        >
          {busy === "confirm" ? (
            <ActivityIndicator color={theme.colors.accentText} />
          ) : (
            <Text style={styles.primaryText}>Подтвердить</Text>
          )}
        </Pressable>
      </View>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.accent,
      padding: theme.spacing(4),
      gap: theme.spacing(3),
      ...theme.shadows.sm,
    },
    chip: { color: theme.colors.accent, fontSize: 13, fontWeight: "700" },
    name: { fontSize: 18, fontWeight: "700", color: theme.colors.text },
    text: { ...theme.typography.body, color: theme.colors.textSecondary },
    actions: { flexDirection: "row", gap: theme.spacing(2) },
    button: {
      flex: 1,
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    secondary: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    secondaryText: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
    primary: { backgroundColor: theme.colors.accent },
    primaryText: {
      color: theme.colors.accentText,
      fontSize: 15,
      fontWeight: "700",
    },
    disabled: { opacity: 0.5 },
  })
