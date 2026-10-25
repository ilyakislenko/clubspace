import { useNavigation } from "@react-navigation/native"
import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useRef, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { AppNavigation, RootStackParamList } from "../../app/navigation"
import { fetchMe } from "../../shared/api/me"
import {
  acceptPersonalTraining,
  cancelPersonalTraining,
  declinePersonalTraining,
  getPersonalTraining,
  proposePersonalTrainingTime,
  type PersonalTraining,
} from "../../shared/api/personal-trainings"
import { showAlert } from "../../shared/alert"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { CenteredColumn, READABLE_WIDTH } from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { KeyboardAvoidingContainer } from "../../shared/components/KeyboardAvoidingContainer"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { TextInput } from "../../shared/components/TextInput"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import { haptics } from "../../shared/haptics"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useKeepFocusedInputVisible } from "../../shared/use-keep-focused-input-visible"
import {
  actsAsCoach,
  emptyTimeOption,
  formatPtTime,
  latestCoachOption,
  viewerRole,
  wallClockOf,
} from "./personal-training-helpers"
import { PtStatusPill } from "./PtStatusPill"
import { TimeOptionPicker } from "./TimeOptionPicker"

type Props = NativeStackScreenProps<RootStackParamList, "PersonalTraining">

type Mode = "propose" | "decline" | null

export function PersonalTrainingScreen({ route }: Props) {
  const { requestId } = route.params
  const navigation = useNavigation<AppNavigation>()
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const scrollRef = useRef<ScrollView>(null)
  const keyboardScroll = useKeepFocusedInputVisible(scrollRef)
  const { workspace } = useAuth()
  const { showToast } = useToast()
  const workspaceId = workspace?.workspaceId

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>(null)
  const [proposal, setProposal] = useState(emptyTimeOption())
  const [proposalComment, setProposalComment] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const me = useCachedResource(
    workspaceId ? `me:${workspaceId}` : null,
    useCallback(async () => await fetchMe(), []),
  )
  // Under the list's `personal-trainings:me:<ws>` scope, so a push or the other
  // side's action refreshes this screen too.
  const request = useCachedResource<PersonalTraining>(
    workspaceId ? `personal-trainings:me:${workspaceId}:${requestId}` : null,
    useCallback(
      async () =>
        await getPersonalTraining({ workspaceId: workspaceId!, requestId }),
      [workspaceId, requestId],
    ),
  )

  if (!workspace) return null

  const pt = request.data
  if (!pt || !me.data) {
    const failure = request.error ?? me.error
    return (
      <View style={styles.center}>
        {failure ? (
          <ErrorRetry
            message={failure}
            onRetry={() => {
              request.refetch()
              me.refetch()
            }}
          />
        ) : (
          <ActivityIndicator color={theme.colors.accent} />
        )}
      </View>
    )
  }

  const viewer = viewerRole(pt, me.data.id)
  const coachSide = actsAsCoach(viewer)
  const status = pt.displayStatus
  // Per render: an option slides into the past while the screen is open.
  const now = Date.now()
  const isPast = (iso: string) => new Date(iso).getTime() <= now
  const memberOptions = pt.options.filter((o) => o.proposedBy === "member")
  const coachOption = latestCoachOption(pt.options)
  const chosenId =
    selectedId ?? memberOptions.find((o) => !isPast(o.startAt))?.id ?? null
  const time = (o: { startAt: string; durationMin: number }) =>
    formatPtTime(o.startAt, o.durationMin, pt.timezone)
  const counterpart =
    viewer === "member"
      ? pt.coach.displayName
      : viewer === "coach"
        ? pt.member.displayName
        : "Ученик и тренер"

  const run = async (
    action: () => Promise<PersonalTraining>,
    fallback: string,
    toast?: string,
  ) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const next = await action()
      request.mutate(next)
      setMode(null)
      setReason("")
      setProposalComment("")
      setProposal(emptyTimeOption())
      haptics.success()
      if (toast) showToast(toast, "success")
    } catch (e) {
      setError(errorMessage(e, fallback))
      // A 409 means the other side moved first: show what is true now.
      request.refetch()
    } finally {
      setBusy(false)
    }
  }

  const accept = (optionId: string) =>
    run(
      () =>
        acceptPersonalTraining({
          workspaceId: workspace.workspaceId,
          requestId,
          optionId,
        }),
      "Не удалось подтвердить",
      "Тренировка подтверждена",
    )

  const propose = () => {
    const startAt = wallClockOf(proposal)
    if (!startAt) {
      setError("Выберите дату и время")
      return
    }
    void run(
      () =>
        proposePersonalTrainingTime({
          workspaceId: workspace.workspaceId,
          requestId,
          data: {
            startAt,
            durationMin: proposal.durationMin,
            comment: proposalComment.trim() ? proposalComment.trim() : undefined,
          },
        }),
      "Не удалось отправить предложение",
      "Предложение отправлено",
    )
  }

  const close = (kind: "decline" | "cancel") =>
    run(
      () =>
        (kind === "decline" ? declinePersonalTraining : cancelPersonalTraining)({
          workspaceId: workspace.workspaceId,
          requestId,
          comment: reason.trim() ? reason.trim() : undefined,
        }),
      kind === "decline"
        ? "Не удалось отклонить"
        : "Не удалось отменить",
      kind === "decline" ? "Заявка отклонена" : "Заявка отменена",
    )

  const confirmCancelSession = () =>
    showAlert("Отменить тренировку?", `${counterpart} получит уведомление.`, [
      { text: "Нет", style: "cancel" },
      {
        text: "Отменить",
        style: "destructive",
        onPress: () => void close("cancel"),
      },
    ])

  const openRoster = () => {
    if (!pt.sessionId) return
    navigation.navigate("SessionRoster", {
      sessionId: pt.sessionId,
      title: `Персональная · ${pt.member.displayName}`,
    })
  }

  const proposeToggle = (
    <Button
      label="Предложить другое время"
      onPress={() => setMode(mode === "propose" ? null : "propose")}
      kind="secondary"
      disabled={busy}
    />
  )
  const proposePanel = mode === "propose" && (
    <View style={styles.panel}>
      <TimeOptionPicker
        value={proposal}
        onChange={setProposal}
        timeZone={pt.timezone}
      />
      <Text style={styles.label}>Комментарий (необязательно)</Text>
      <TextInput
        value={proposalComment}
        onChangeText={setProposalComment}
        placeholderTextColor={theme.colors.muted}
        multiline
        maxLength={500}
        style={styles.input}
      />
      <Button
        label={busy ? "Отправляем…" : "Отправить предложение"}
        onPress={propose}
        disabled={busy}
      />
    </View>
  )
  const declineToggle = (label: string) => (
    <Button
      label={label}
      onPress={() => setMode(mode === "decline" ? null : "decline")}
      kind="secondary"
      disabled={busy}
    />
  )
  const declinePanel = mode === "decline" && (
    <View style={styles.panel}>
      <Text style={styles.label}>Причина (необязательно)</Text>
      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholderTextColor={theme.colors.muted}
        multiline
        maxLength={500}
        style={styles.input}
      />
      <Button
        label={
          busy ? "Отправляем…" : viewer === "member" ? "Отказаться" : "Отклонить"
        }
        onPress={() => void close("decline")}
        kind="danger"
        disabled={busy}
      />
    </View>
  )
  const cancelRequest = (
    <Button
      label="Отменить заявку"
      onPress={() => void close("cancel")}
      kind="secondary"
      disabled={busy}
    />
  )
  const markAttendance = coachSide && !!pt.sessionId && (
    <Button label="Отметить посещение" onPress={openRoster} />
  )

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <KeyboardAvoidingContainer style={styles.flex}>
          <ScrollView
            ref={scrollRef}
            {...keyboardScroll}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={request.refreshing}
                onRefresh={request.refetch}
                tintColor={theme.colors.accent}
              />
            }
          >
            {request.stale && <OfflineNotice />}

            <View style={styles.header}>
              <PtStatusPill status={status} />
              <Text style={styles.title}>Персональная тренировка</Text>
              {viewer !== "coach" && (
                <Text style={styles.meta}>Тренер: {pt.coach.displayName}</Text>
              )}
              {viewer !== "member" && (
                <Text style={styles.meta}>Ученик: {pt.member.displayName}</Text>
              )}
              <Text style={styles.meta}>
                {pt.gym ? `Зал: ${pt.gym.name}, ${pt.gym.address}` : "Зал не выбран"}
              </Text>
              {pt.confirmedStartAt && (
                <Text style={styles.when}>
                  {time({
                    startAt: pt.confirmedStartAt,
                    durationMin: pt.confirmedDurationMin ?? 0,
                  })}
                </Text>
              )}
              {pt.memberComment && (
                <Text style={styles.meta}>
                  Комментарий ученика: {pt.memberComment}
                </Text>
              )}
            </View>

            {status === "PENDING_COACH" && coachSide && (
              <>
                <View style={styles.block}>
                  <Text style={styles.label}>Ученик предлагает:</Text>
                  {memberOptions.map((o) => {
                    const past = isPast(o.startAt)
                    const selected = o.id === chosenId
                    return (
                      <Pressable
                        key={o.id}
                        onPress={() => setSelectedId(o.id)}
                        disabled={past}
                        accessibilityRole="button"
                        accessibilityState={{ selected, disabled: past }}
                        style={[
                          styles.optionRow,
                          selected && !past && styles.optionRowSelected,
                        ]}
                      >
                        <View
                          style={[styles.radio, selected && !past && styles.radioOn]}
                        >
                          {selected && !past && <View style={styles.radioDot} />}
                        </View>
                        <Text
                          style={[styles.optionText, past && styles.optionPast]}
                        >
                          {time(o)}
                          {past ? " · прошло" : ""}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
                <Button
                  label={busy ? "Подтверждаем…" : "Подтвердить выбранное время"}
                  onPress={() => chosenId && void accept(chosenId)}
                  disabled={busy || !chosenId}
                />
                {proposeToggle}
                {proposePanel}
                {declineToggle("Отклонить заявку")}
                {declinePanel}
              </>
            )}

            {status === "PENDING_COACH" && !coachSide && (
              <>
                <View style={styles.block}>
                  <Text style={styles.label}>Ваши варианты:</Text>
                  {memberOptions.map((o) => (
                    <Text key={o.id} style={styles.optionText}>
                      {time(o)}
                    </Text>
                  ))}
                </View>
                <Text style={styles.muted}>Ждём ответа тренера</Text>
                {cancelRequest}
              </>
            )}

            {status === "PENDING_MEMBER" && !coachSide && coachOption && (
              <>
                <View style={styles.block}>
                  <Text style={styles.label}>Тренер предлагает:</Text>
                  <Text style={styles.optionText}>{time(coachOption)}</Text>
                  {pt.coachComment && (
                    <Text style={styles.meta}>{pt.coachComment}</Text>
                  )}
                </View>
                <Button
                  label={busy ? "Подтверждаем…" : "Подтвердить"}
                  onPress={() => void accept(coachOption.id)}
                  disabled={busy}
                />
                {declineToggle("Отказаться")}
                {declinePanel}
              </>
            )}

            {status === "PENDING_MEMBER" && coachSide && (
              <>
                <Text style={styles.optionText}>
                  Вы предложили: {coachOption ? time(coachOption) : ""}. Ждём
                  ответа ученика.
                </Text>
                {proposeToggle}
                {proposePanel}
                {cancelRequest}
              </>
            )}

            {status === "CONFIRMED" && (
              <>
                {markAttendance}
                <Button
                  label="Отменить тренировку"
                  onPress={confirmCancelSession}
                  kind="secondary"
                  disabled={busy}
                />
              </>
            )}

            {status === "COMPLETED" && markAttendance}

            {(status === "DECLINED" || status === "CANCELLED") && (
              <View style={styles.block}>
                <Text style={styles.optionText}>
                  {status === "DECLINED" ? "Отклонена" : "Отменена"}{" "}
                  {pt.closedByRole === "coach" ? "тренером" : "учеником"}
                </Text>
                {pt.closeComment && (
                  <Text style={styles.meta}>Комментарий: {pt.closeComment}</Text>
                )}
              </View>
            )}

            {status === "EXPIRED" && (
              <>
                <Text style={styles.optionText}>Предложенное время прошло.</Text>
                {coachSide ? (
                  <>
                    {proposeToggle}
                    {proposePanel}
                  </>
                ) : (
                  <Button
                    label="Создать новую заявку"
                    onPress={() => navigation.navigate("PersonalTrainingRequest")}
                  />
                )}
              </>
            )}

            {error && <Text style={styles.danger}>{error}</Text>}
          </ScrollView>
        </KeyboardAvoidingContainer>
      </CenteredColumn>
    </SafeAreaView>
  )
}

function Button({
  label,
  onPress,
  kind = "primary",
  disabled,
}: {
  label: string
  onPress: () => void
  kind?: "primary" | "secondary" | "danger"
  disabled?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={[
        styles.button,
        kind === "primary" && styles.buttonPrimary,
        kind === "secondary" && styles.buttonSecondary,
        kind === "danger" && styles.buttonDanger,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          kind === "primary" && styles.buttonPrimaryText,
          kind === "danger" && styles.buttonDangerText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
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
    body: { padding: theme.spacing(5), gap: theme.spacing(3) },
    header: { gap: theme.spacing(1), alignItems: "flex-start" },
    title: { ...theme.typography.title, fontSize: 22, color: theme.colors.text },
    meta: { fontSize: 13, color: theme.colors.muted },
    when: {
      fontSize: 15,
      fontWeight: "600",
      color: theme.colors.text,
      marginTop: theme.spacing(1),
    },
    block: { gap: theme.spacing(2) },
    label: { ...theme.typography.label, color: theme.colors.muted },
    muted: { fontSize: 13, color: theme.colors.muted },
    danger: { fontSize: 13, color: theme.colors.danger },
    optionText: { fontSize: 15, color: theme.colors.text },
    optionPast: {
      textDecorationLine: "line-through",
      color: theme.colors.muted,
    },
    optionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    optionRowSelected: { borderColor: theme.colors.accent },
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
    panel: {
      gap: theme.spacing(3),
      padding: theme.spacing(4),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
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
      backgroundColor: theme.colors.surface,
    },
    button: {
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.md,
      alignItems: "center",
      justifyContent: "center",
    },
    buttonPrimary: { backgroundColor: theme.colors.accent },
    buttonSecondary: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    buttonDanger: {
      borderWidth: 1,
      borderColor: theme.colors.danger,
      backgroundColor: theme.colors.dangerSoft,
    },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
    buttonPrimaryText: { color: theme.colors.accentText, fontWeight: "700" },
    buttonDangerText: { color: theme.colors.danger, fontWeight: "700" },
  })
