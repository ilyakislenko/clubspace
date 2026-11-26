import React, { useState } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import {
  declareTournamentEntry,
  type ClubTournamentEntry,
  type CompetitorSex,
} from "../../shared/api/tournaments"
import { choiceA11y } from "../../shared/choice-a11y"
import { Pressable } from "../../shared/components/Pressable"
import { Sheet, useSheetAction } from "../../shared/components/Sheet"
import { TextInput } from "../../shared/components/TextInput"
import { errorCode, errorMessage } from "../../shared/error-message"
import { haptics } from "../../shared/haptics"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useVocabulary } from "../../shared/use-vocabulary"
import { formatKg, parseKgInput, WEIGHT_KG } from "./tournament-helpers"

/**
 * «Заявка на турнир»: the weight (kg, one decimal), sex and — when the
 * profile has no birth date — the birth year. The athlete (a guardian for the
 * child) sends it to the coach; a coach declaring for a student
 * (`student`) confirms it at once. On an older federation consent the
 * server answers ORG_CONSENT_REQUIRED: the sheet closes and `onConsentRequired`
 * lets the caller show the consent first (a sheet never opens a sheet).
 */
export function TournamentEntrySheet({
  workspaceId,
  eventId,
  title,
  forChild,
  student,
  initial,
  profileBirthYear,
  onSaved,
  onConsentRequired,
  onClosed,
}: {
  workspaceId: string
  eventId: string
  title: string
  forChild: boolean
  // A coach declaring for this student.
  student?: { userId: string; name: string }
  initial: Pick<ClubTournamentEntry, "declaredWeightKg" | "sex"> | null
  profileBirthYear: number | null
  onSaved: (entry: ClubTournamentEntry) => void
  onConsentRequired?: () => void
  onClosed: () => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const vocabulary = useVocabulary()
  const sheet = useSheetAction({ initiallyOpen: true, onClosed })
  const [weight, setWeight] = useState(initial?.declaredWeightKg != null ? formatKg(initial.declaredWeightKg) : "")
  const [sex, setSex] = useState<CompetitorSex | null>(initial?.sex ?? null)
  const [birthYear, setBirthYear] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const kg = parseKgInput(weight)
  const year = profileBirthYear ?? (/^\d{4}$/.test(birthYear.trim()) ? Number(birthYear.trim()) : null)
  const yearValid = year !== null && year >= 1930 && year <= new Date().getFullYear()
  const ready = kg !== null && sex !== null && yearValid
  const kids = forChild || (year !== null && new Date().getFullYear() - year < 18)
  const sexOptions: { value: CompetitorSex; label: string }[] = [
    { value: "MALE", label: kids ? "Мальчик" : "Мужчина" },
    { value: "FEMALE", label: kids ? "Девочка" : "Женщина" },
  ]

  const submit = async () => {
    if (!ready) {
      setError(
        kg === null
          ? `Вес — от ${WEIGHT_KG.min} до ${WEIGHT_KG.max} кг, например 77,4`
          : sex === null
            ? "Укажите пол"
            : "Укажите год рождения",
      )
      return
    }
    setBusy(true)
    setError(null)
    try {
      const entry = await declareTournamentEntry({
        workspaceId,
        eventId,
        body: {
          ...(student ? { userId: student.userId } : {}),
          declaredWeightKg: kg,
          sex,
          ...(profileBirthYear === null ? { birthYear: year } : {}),
        },
      })
      haptics.success()
      sheet.run(() => onSaved(entry))
    } catch (e) {
      if (errorCode(e) === "ORG_CONSENT_REQUIRED" && !student && onConsentRequired) {
        sheet.run(onConsentRequired)
        return
      }
      setError(
        errorCode(e) === "ORG_CONSENT_REQUIRED"
          ? "Ученик должен обновить согласие в приложении"
          : errorMessage(e, "Не удалось отправить заявку"),
      )
      setBusy(false)
    }
  }

  return (
    <Sheet title={student ? student.name : "Заявка на турнир"} {...sheet.sheetProps}>
      <View style={styles.body}>
        <Text style={styles.event} numberOfLines={2}>
          {title}
        </Text>
        <View style={styles.field}>
          <Text style={styles.label}>Вес, кг</Text>
          <TextInput
            value={weight}
            onChangeText={setWeight}
            keyboardType="decimal-pad"
            inputMode="decimal"
            // iOS decimal/number pads have no return key: this bar's «Готово»
            // closes the keyboard (RN's own label is the English «Done»).
            returnKeyType="done"
            inputAccessoryViewButtonLabel="Готово"
            placeholder="77,4"
            placeholderTextColor={theme.colors.muted}
            style={styles.input}
            accessibilityLabel="Вес, кг"
            autoFocus={!initial}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Пол</Text>
          <View style={styles.segments} accessibilityRole="radiogroup">
            {sexOptions.map((o) => {
              const active = sex === o.value
              return (
                <Pressable
                  key={o.value}
                  onPress={() => setSex(o.value)}
                  {...choiceA11y("radio", active)}
                  style={[styles.segment, active && styles.segmentActive]}
                >
                  <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{o.label}</Text>
                </Pressable>
              )
            })}
          </View>
        </View>
        {profileBirthYear === null && (
          <View style={styles.field}>
            <Text style={styles.label}>Год рождения</Text>
            <TextInput
              value={birthYear}
              onChangeText={setBirthYear}
              keyboardType="number-pad"
              inputMode="numeric"
              returnKeyType="done"
              inputAccessoryViewButtonLabel="Готово"
              maxLength={4}
              placeholder="2012"
              placeholderTextColor={theme.colors.muted}
              style={styles.input}
              accessibilityLabel="Год рождения"
            />
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable
          onPress={() => void submit()}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        >
          {busy ? (
            <ActivityIndicator color={theme.colors.accentText} />
          ) : (
            <Text style={styles.primaryText}>{student ? "Подтвердить заявку" : `Отправить ${vocabulary.coach.dat}`}</Text>
          )}
        </Pressable>
      </View>
    </Sheet>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    body: { gap: theme.spacing(3) },
    event: { ...theme.typography.bodyStrong, color: theme.colors.text },
    field: { gap: theme.spacing(1) },
    label: { ...theme.typography.label },
    input: {
      height: 48,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing(4),
      fontSize: 17,
      color: theme.colors.text,
      backgroundColor: theme.colors.surfaceMuted,
    },
    segments: { flexDirection: "row", gap: theme.spacing(2) },
    segment: {
      flex: 1,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    segmentActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
    segmentText: { fontSize: 15, color: theme.colors.text },
    segmentTextActive: { fontWeight: "700", color: theme.colors.accent },
    error: { fontSize: 13, color: theme.colors.danger },
    primary: {
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryText: { color: theme.colors.accentText, fontSize: 15, fontWeight: "700" },
    pressed: { opacity: 0.85 },
  })
