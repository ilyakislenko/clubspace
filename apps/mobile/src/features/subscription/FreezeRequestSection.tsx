import React, { useState } from "react"
import { StyleSheet, Text, View } from "react-native"

import { showAlert } from "../../shared/alert"
import {
  cancelSubscriptionFreezeRequest,
  requestSubscriptionFreeze,
  type FreezeRequest,
  type FreezeRequestWindow,
} from "../../shared/api/subscriptions"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { parseWholeNumber } from "./coach-subscription-actions"
import {
  addDaysYmd,
  DAY_PRESETS,
  daysInclusive,
  REASON_MAX,
  REASON_PRESETS,
  requestSummary,
  startChoices,
  untilChoices,
} from "./freeze-request-helpers"
import { freezeExtendsText } from "./subscription-state"

type Props = {
  workspaceId: string
  request: FreezeRequest | null
  window: FreezeRequestWindow | null
  onChanged: () => void
}

type Length = "days" | "until"

const OTHER = "other"

/**
 * The member's side of a freeze request, under the abonement card: the pending
 * request (cancellable), a recent decline with the coach's comment, and — while
 * the server's `window` says asking is possible — the form to ask. Writes go
 * straight to the server and are never queued offline: the member must hear a
 * refusal now, not after a retry.
 */
export function FreezeRequestSection({
  workspaceId,
  request,
  window,
  onChanged,
}: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { showToast } = useToast()

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fromYmd, setFromYmd] = useState<string | null>(null)
  const [length, setLength] = useState<Length>("days")
  const [daysText, setDaysText] = useState("7")
  const [untilYmd, setUntilYmd] = useState<string | null>(null)
  const [reasonChoice, setReasonChoice] = useState<string | null>(null)
  const [otherText, setOtherText] = useState("")

  const pending = request?.status === "PENDING" ? request : null
  const declined = request?.status === "DECLINED" ? request : null

  const openForm = () => {
    if (!window) return
    setFromYmd(window.firstDate)
    setLength("days")
    setDaysText("7")
    setUntilYmd(null)
    setReasonChoice(null)
    setOtherText("")
    setOpen(true)
  }

  const from = fromYmd ?? window?.firstDate ?? null
  const maxDays = window?.maxDays ?? 0
  const days =
    length === "days"
      ? parseWholeNumber(daysText, { min: 1, max: maxDays })
      : from !== null && untilYmd !== null && untilYmd >= from
        ? daysInclusive(from, untilYmd)
        : null
  const validDays = days !== null && days >= 1 && days <= maxDays ? days : null
  const reason = reasonChoice === OTHER ? otherText.trim() : (reasonChoice ?? "")
  const canSend = from !== null && validDays !== null && reason.length > 0

  const send = async () => {
    if (busy || !canSend || from === null || validDays === null) return
    setBusy(true)
    try {
      await requestSubscriptionFreeze({
        workspaceId,
        data: { fromDate: from, days: validDays, reason },
      })
      setOpen(false)
      showToast("Заявка отправлена тренеру", "success")
      onChanged()
    } catch (e) {
      showToast(errorMessage(e, "Не удалось отправить заявку"), "error")
      // The state may have changed under us (a coach froze it, a request exists).
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const confirmCancel = () => {
    if (!pending) return
    const requestId = pending.id
    showAlert("Отменить заявку?", "Тренер её больше не увидит.", [
      { text: "Оставить", style: "cancel" },
      {
        text: "Отменить заявку",
        style: "destructive",
        onPress: () => {
          void (async () => {
            if (busy) return
            setBusy(true)
            try {
              await cancelSubscriptionFreezeRequest({ workspaceId, requestId })
              showToast("Заявка отменена", "success")
              onChanged()
            } catch (e) {
              showToast(errorMessage(e, "Не удалось отменить заявку"), "error")
              onChanged()
            } finally {
              setBusy(false)
            }
          })()
        },
      },
    ])
  }

  const chip = (
    key: string,
    label: string,
    selected: boolean,
    onPress: () => void,
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>
        {label}
      </Text>
    </Pressable>
  )

  return (
    <>
      {pending && (
        <View style={styles.card}>
          <Text style={styles.title}>Заявка на заморозку</Text>
          <Text style={styles.line}>{requestSummary(pending)}</Text>
          <Text style={styles.meta}>Причина: {pending.reason}</Text>
          <Text style={styles.status}>Ждёт ответа тренера</Text>
          <View style={styles.row}>
            <Pressable
              onPress={confirmCancel}
              disabled={busy}
              accessibilityRole="button"
              style={[styles.secondary, busy && styles.disabled]}
            >
              <Text style={styles.secondaryText}>Отменить заявку</Text>
            </Pressable>
          </View>
        </View>
      )}

      {declined && (
        <Text style={styles.meta}>
          Заявка на заморозку отклонена
          {declined.decisionComment
            ? `. ${declined.decidedByName ?? "Тренер"}: «${declined.decisionComment}»`
            : ""}
        </Text>
      )}

      {window && !pending && !open && (
        <View style={styles.row}>
          <Pressable
            onPress={openForm}
            accessibilityRole="button"
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Попросить заморозку</Text>
          </Pressable>
        </View>
      )}

      {window && !pending && open && (
        <View style={styles.card}>
          <Text style={styles.title}>Попросить заморозку</Text>

          <Text style={styles.label}>С какого дня</Text>
          <View style={styles.chips}>
            {startChoices(window).map((c) =>
              chip(c.ymd, c.label, from === c.ymd, () => {
                setFromYmd(c.ymd)
                setUntilYmd(null)
              }),
            )}
          </View>

          <Text style={styles.label}>Сколько</Text>
          <View style={styles.chips}>
            {chip("days", "Дней", length === "days", () => setLength("days"))}
            {chip("until", "До даты", length === "until", () =>
              setLength("until"),
            )}
          </View>
          {length === "days" ? (
            <>
              <View style={styles.chips}>
                {DAY_PRESETS.filter((d) => d <= maxDays).map((d) =>
                  chip(String(d), `${d} дн.`, daysText === String(d), () =>
                    setDaysText(String(d)),
                  ),
                )}
              </View>
              <TextInput
                value={daysText}
                onChangeText={setDaysText}
                keyboardType="number-pad"
                accessibilityLabel="Дней заморозки"
                placeholderTextColor={theme.colors.muted}
                style={styles.input}
              />
              {validDays === null && (
                <Text style={styles.invalid}>
                  Введите число от 1 до {maxDays}
                </Text>
              )}
            </>
          ) : (
            from !== null && (
              <View style={styles.chips}>
                {untilChoices(from, maxDays).map((c) =>
                  chip(c.ymd, c.label, untilYmd === c.ymd, () =>
                    setUntilYmd(c.ymd),
                  ),
                )}
              </View>
            )
          )}

          <Text style={styles.label}>Причина</Text>
          <View style={styles.chips}>
            {REASON_PRESETS.map((r) =>
              chip(r, r, reasonChoice === r, () => setReasonChoice(r)),
            )}
            {chip(OTHER, "Другое", reasonChoice === OTHER, () =>
              setReasonChoice(OTHER),
            )}
          </View>
          {reasonChoice === OTHER && (
            <TextInput
              value={otherText}
              onChangeText={setOtherText}
              placeholder="Опишите причину"
              placeholderTextColor={theme.colors.muted}
              maxLength={REASON_MAX}
              accessibilityLabel="Причина заморозки"
              style={styles.input}
            />
          )}

          {from !== null && validDays !== null && (
            <>
              <Text style={styles.line}>
                {requestSummary({
                  fromDate: from,
                  untilDate: addDaysYmd(from, validDays - 1),
                  days: validDays,
                })}
              </Text>
              <Text style={styles.meta}>{freezeExtendsText(validDays)}</Text>
            </>
          )}

          <View style={styles.row}>
            <Pressable
              onPress={() => void send()}
              disabled={busy || !canSend}
              accessibilityRole="button"
              style={[styles.primary, (busy || !canSend) && styles.disabled]}
            >
              <Text style={styles.primaryText}>
                {busy ? "Отправляю…" : "Отправить тренеру"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setOpen(false)}
              disabled={busy}
              accessibilityRole="button"
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Отмена</Text>
            </Pressable>
          </View>
        </View>
      )}
    </>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      padding: theme.spacing(4),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: theme.spacing(2),
    },
    title: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
    line: { color: theme.colors.accent, fontSize: 14, fontWeight: "600" },
    meta: { color: theme.colors.muted, fontSize: 13 },
    status: { color: theme.colors.muted, fontSize: 13, fontWeight: "600" },
    label: { ...theme.typography.bodyStrong, color: theme.colors.text },
    invalid: { ...theme.typography.caption, color: theme.colors.danger },
    row: { flexDirection: "row", gap: theme.spacing(2), flexWrap: "wrap" },
    chips: { flexDirection: "row", gap: theme.spacing(2), flexWrap: "wrap" },
    chip: {
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
    },
    chipOn: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.accent,
    },
    chipText: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
    chipTextOn: { color: theme.colors.accentText },
    input: {
      color: theme.colors.text,
      fontSize: 15,
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
    },
    primary: {
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.accent,
    },
    primaryText: {
      color: theme.colors.accentText,
      fontSize: 14,
      fontWeight: "600",
    },
    secondary: {
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceMuted,
    },
    secondaryText: {
      color: theme.colors.text,
      fontSize: 14,
      fontWeight: "600",
    },
    disabled: { opacity: 0.5 },
  })
