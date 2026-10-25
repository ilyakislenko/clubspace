import { useNavigation } from "@react-navigation/native"
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { AppNavigation } from "../../app/navigation"
import {
  getPersonalTrainingForm,
  requestPersonalTraining,
  type PersonalTrainingForm,
} from "../../shared/api/personal-trainings"
import { useAuth } from "../../shared/auth-context"
import { CenteredColumn, READABLE_WIDTH } from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { KeyboardAvoidingContainer } from "../../shared/components/KeyboardAvoidingContainer"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import { haptics } from "../../shared/haptics"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useKeepFocusedInputVisible } from "../../shared/use-keep-focused-input-visible"
import { formatTimezoneLabel } from "../schedule/club-schedule-buckets"
import {
  emptyTimeOption,
  wallClockOf,
  type TimeOptionValue,
} from "./personal-training-helpers"
import { TimeOptionPicker } from "./TimeOptionPicker"

const MAX_OPTIONS = 3

export function PersonalTrainingRequestScreen() {
  const navigation = useNavigation<AppNavigation>()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const scrollRef = useRef<ScrollView>(null)
  const keyboardScroll = useKeepFocusedInputVisible(scrollRef)
  const { workspace } = useAuth()
  const { showToast } = useToast()

  const [form, setForm] = useState<PersonalTrainingForm | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [coachId, setCoachId] = useState<string | null>(null)
  // null = «Не важно»: the session may be held anywhere.
  const [gymId, setGymId] = useState<string | null>(null)
  const [options, setOptions] = useState<TimeOptionValue[]>([emptyTimeOption()])
  const [comment, setComment] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!workspace) return
    setLoadError(null)
    try {
      setForm(
        await getPersonalTrainingForm({ workspaceId: workspace.workspaceId }),
      )
    } catch (e) {
      setLoadError(errorMessage(e, "Не удалось загрузить форму"))
    }
  }, [workspace])

  useEffect(() => {
    void load()
  }, [load])

  if (!workspace) return null

  if (!form) {
    return (
      <View style={styles.center}>
        {loadError ? (
          <ErrorRetry message={loadError} onRetry={() => void load()} />
        ) : (
          <ActivityIndicator color={theme.colors.accent} />
        )}
      </View>
    )
  }

  const gym = form.gyms.find((g) => g.id === gymId) ?? null
  // The zone the proposed times are read in: the gym's, else the club's.
  const timeZone = gym?.timezone ?? form.timezone

  const setOption = (index: number, next: TimeOptionValue) =>
    setOptions((prev) => prev.map((o, i) => (i === index ? next : o)))

  const submit = async () => {
    if (busy) return
    if (!coachId) {
      setError("Выберите тренера")
      return
    }
    const wallClocks = options.map(wallClockOf)
    if (wallClocks.some((w) => w === null)) {
      setError("Выберите дату и время для каждого варианта")
      return
    }
    if (new Set(wallClocks).size !== wallClocks.length) {
      setError("Варианты не должны совпадать")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await requestPersonalTraining({
        workspaceId: workspace.workspaceId,
        data: {
          coachId,
          gymId,
          options: options.map((o, i) => ({
            startAt: wallClocks[i]!,
            durationMin: o.durationMin,
          })),
          comment: comment.trim() ? comment.trim() : undefined,
        },
      })
      haptics.success()
      showToast("Заявка отправлена — тренер получит уведомление", "success")
      navigation.replace("PersonalTraining", { requestId: created.id })
    } catch (e) {
      setError(errorMessage(e, "Не удалось отправить заявку"))
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <KeyboardAvoidingContainer style={styles.flex}>
          <ScrollView
            ref={scrollRef}
            {...keyboardScroll}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.intro}>
              Выберите тренера и предложите до трёх вариантов времени. Тренер
              подтвердит один из них или предложит своё.
            </Text>

            <View style={styles.block}>
              <Text style={styles.label}>Тренер</Text>
              {form.coaches.map((c) => {
                const selected = c.userId === coachId
                return (
                  <Pressable
                    key={c.userId}
                    onPress={() => setCoachId(c.userId)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[styles.coachRow, selected && styles.coachRowSelected]}
                  >
                    <View style={[styles.radio, selected && styles.radioOn]}>
                      {selected && <View style={styles.radioDot} />}
                    </View>
                    <Text style={styles.coachName} numberOfLines={1}>
                      {c.displayName}
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            <View style={styles.block}>
              <Text style={styles.label}>Зал</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipsScroll}
                contentContainerStyle={styles.chips}
              >
                {[{ id: null, name: "Не важно" }, ...form.gyms].map((g) => {
                  const selected = g.id === gymId
                  return (
                    <Pressable
                      key={g.id ?? "any"}
                      onPress={() => setGymId(g.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[styles.chip, selected && styles.chipSelected]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          selected && styles.chipTextSelected,
                        ]}
                      >
                        {g.name}
                      </Text>
                    </Pressable>
                  )
                })}
              </ScrollView>
              <Text style={styles.muted}>
                Время — по часовому поясу {gym ? "зала" : "клуба"} (
                {formatTimezoneLabel(timeZone)})
              </Text>
            </View>

            {options.map((option, index) => (
              <View key={index} style={styles.block}>
                <View style={styles.optionHead}>
                  <Text style={styles.label}>Вариант {index + 1}</Text>
                  {options.length > 1 && (
                    <Pressable
                      onPress={() =>
                        setOptions((prev) => prev.filter((_, i) => i !== index))
                      }
                      hitSlop={8}
                      accessibilityRole="button"
                    >
                      <Text style={styles.link}>Убрать</Text>
                    </Pressable>
                  )}
                </View>
                <TimeOptionPicker
                  value={option}
                  onChange={(next) => setOption(index, next)}
                  timeZone={timeZone}
                />
              </View>
            ))}

            {options.length < MAX_OPTIONS && (
              <Pressable
                onPress={() =>
                  setOptions((prev) => [...prev, emptyTimeOption()])
                }
                accessibilityRole="button"
                style={styles.addOption}
              >
                <Text style={styles.link}>+ Добавить вариант</Text>
              </Pressable>
            )}

            <View style={styles.block}>
              <Text style={styles.label}>
                Комментарий для тренера (необязательно)
              </Text>
              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder="Например: цель тренировки или пожелания"
                placeholderTextColor={theme.colors.muted}
                multiline
                maxLength={500}
                style={styles.input}
              />
            </View>

            {error && <Text style={styles.danger}>{error}</Text>}

            <Pressable
              onPress={() => void submit()}
              disabled={busy}
              accessibilityRole="button"
              style={styles.submit}
            >
              {busy ? (
                <ActivityIndicator color={theme.colors.accentText} />
              ) : (
                <Text style={styles.submitText}>Отправить заявку</Text>
              )}
            </Pressable>
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
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.background,
    },
    body: { padding: theme.spacing(5), gap: theme.spacing(4) },
    intro: { ...theme.typography.body, color: theme.colors.muted },
    block: { gap: theme.spacing(2) },
    label: { ...theme.typography.label, color: theme.colors.muted },
    muted: { ...theme.typography.caption, color: theme.colors.muted },
    danger: { ...theme.typography.caption, color: theme.colors.danger },
    link: { fontSize: 14, fontWeight: "700", color: theme.colors.accent },
    coachRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    coachRowSelected: { borderColor: theme.colors.accent },
    coachName: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "600",
    },
    radio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: theme.colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    radioOn: { borderColor: theme.colors.accent },
    radioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: theme.colors.accent,
    },
    chipsScroll: { flexGrow: 0 },
    chips: { gap: theme.spacing(2) },
    chip: {
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    chipSelected: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    chipText: { color: theme.colors.text, fontSize: 14, fontWeight: "500" },
    chipTextSelected: { color: theme.colors.accentText, fontWeight: "700" },
    optionHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    addOption: { alignSelf: "flex-start", paddingVertical: theme.spacing(1) },
    input: {
      minHeight: 64,
      // Grows to ~7 lines, then scrolls inside, so the caret never slips
      // under the keyboard on a short (landscape) screen.
      maxHeight: 160,
      color: theme.colors.text,
      fontSize: 15,
      textAlignVertical: "top",
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceElevated,
    },
    submit: {
      paddingVertical: theme.spacing(4),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.accent,
      alignItems: "center",
    },
    submitText: {
      color: theme.colors.accentText,
      fontSize: 16,
      fontWeight: "700",
    },
  })
