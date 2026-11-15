import React, { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import { showAlert } from "../../shared/alert"
import {
  acceptMyAutopayTerms,
  cancelMyAutopay,
  listMyAutopays,
  type MyAutopay,
} from "../../shared/api/autopay"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { Pressable } from "../../shared/components/Pressable"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  autopayCardView,
  cancelAutopayMessage,
  confirmTermsLabel,
  paidUntilFor,
} from "./autopay-text"
import { toneColor } from "./subscription-state"

type Props = {
  workspaceId: string
  // Bump to re-read (pull-to-refresh, a payment went through).
  reloadKey?: number
  // The member's current abonements: the cancel confirmation names the day
  // the renewed one runs until. Empty on the lock screen.
  abonements?: readonly { planId: string; endDate: string | null }[]
  // The agreements as last read: the host words its hint by them.
  onLoaded?: (list: MyAutopay[]) => void
  // An agreement was cancelled or its terms accepted: the purchase block
  // offers the switch again / the host re-reads.
  onChanged?: () => void
}

/**
 * «Автоплатёж» on «Мой абонемент» and on the expired-access lock screen
 * (design §5.2): the member's agreements — next charge, card, a pending
 * decline, a price rise to confirm, a stop — with one-tap cancel (376-ФЗ:
 * open even when access has run out). Renders nothing without a live
 * agreement or one cancelled in the last 30 days.
 */
export function AutopayCard({
  workspaceId,
  reloadKey,
  abonements = [],
  onLoaded,
  onChanged,
}: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { showToast } = useToast()

  const [list, setList] = useState<MyAutopay[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const next = await listMyAutopays({ workspaceId })
      setList(next)
      setError(null)
      onLoaded?.(next)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить автоплатёж"))
    }
  }, [workspaceId, onLoaded])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const run = async (
    autopayId: string,
    action: () => Promise<unknown>,
    done: string,
    failed: string,
  ) => {
    if (busyId) return
    setBusyId(autopayId)
    try {
      await action()
      showToast(done, "success")
    } catch (e) {
      showToast(errorMessage(e, failed), "error")
    } finally {
      setBusyId(null)
      // Re-read either way: a refusal may come from a state not shown yet
      // (terms changed again, already cancelled).
      void load()
      onChanged?.()
    }
  }

  const confirmCancel = (a: MyAutopay) => {
    showAlert(
      "Отключить автоплатёж?",
      cancelAutopayMessage(paidUntilFor(a.planId, abonements)),
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Отключить",
          style: "destructive",
          onPress: () =>
            void run(
              a.id,
              () => cancelMyAutopay({ workspaceId, autopayId: a.id }),
              "Автоплатёж отключён",
              "Не удалось отключить автоплатёж",
            ),
        },
      ],
    )
  }

  const acceptTerms = (a: MyAutopay) => {
    const terms = a.newTerms
    if (!terms) return
    void run(
      a.id,
      () =>
        acceptMyAutopayTerms({
          workspaceId,
          autopayId: a.id,
          data: {
            amount: terms.amount,
            durationDays: terms.durationDays,
            classCount: terms.classCount,
            consentVersion: terms.consentVersion,
          },
        }),
      "Новые условия приняты",
      "Не удалось подтвердить",
    )
  }

  if (error && !list) {
    return <ErrorRetry message={error} onRetry={() => void load()} />
  }
  if (!list || list.length === 0) return null

  return (
    <View style={styles.root}>
      {list.map((a) => {
        const view = autopayCardView(a)
        const busy = busyId === a.id
        return (
          <View key={a.id} style={styles.card}>
            <Text style={styles.title}>Автоплатёж «{a.planName}»</Text>
            {view.headline && (
              <Text style={styles.headline}>{view.headline}</Text>
            )}
            {view.lines.map((line) => (
              <Text
                key={line.text}
                style={[
                  line.tone === "muted" ? styles.meta : styles.line,
                  line.tone !== "muted" && {
                    color: toneColor(theme.colors, line.tone),
                  },
                ]}
              >
                {line.text}
              </Text>
            ))}
            {view.actions === "confirm" && a.newTerms && (
              <Pressable
                onPress={() => acceptTerms(a)}
                disabled={busyId !== null}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.primaryBtn,
                  pressed && styles.btnPressed,
                  busyId !== null && !busy && styles.btnDisabled,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={theme.colors.accentText} />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {confirmTermsLabel(a.newTerms, a.currency)}
                  </Text>
                )}
              </Pressable>
            )}
            {view.actions === "confirm" && (
              <Pressable
                onPress={() => confirmCancel(a)}
                disabled={busyId !== null}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.textBtn,
                  pressed && styles.btnPressed,
                ]}
              >
                <Text style={styles.textBtnText}>Отключить автоплатёж</Text>
              </Pressable>
            )}
            {view.actions === "cancel" && (
              <Pressable
                onPress={() => confirmCancel(a)}
                disabled={busyId !== null}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  pressed && styles.btnPressed,
                  busyId !== null && !busy && styles.btnDisabled,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={theme.colors.text} />
                ) : (
                  <Text style={styles.secondaryBtnText}>
                    Отключить автоплатёж
                  </Text>
                )}
              </Pressable>
            )}
          </View>
        )
      })}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { gap: theme.spacing(3) },
    card: {
      padding: theme.spacing(4),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: theme.spacing(1),
    },
    title: { color: theme.colors.text, fontSize: 17, fontWeight: "700" },
    headline: { color: theme.colors.success, fontSize: 14, fontWeight: "600" },
    line: { fontSize: 14, fontWeight: "600" },
    meta: { color: theme.colors.muted, fontSize: 13 },
    primaryBtn: {
      marginTop: theme.spacing(2),
      backgroundColor: theme.colors.accent,
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.full,
      alignItems: "center",
    },
    primaryBtnText: {
      color: theme.colors.accentText,
      fontSize: 15,
      fontWeight: "700",
    },
    secondaryBtn: {
      marginTop: theme.spacing(2),
      paddingVertical: theme.spacing(3),
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: "center",
    },
    secondaryBtnText: {
      color: theme.colors.text,
      fontSize: 14,
      fontWeight: "600",
    },
    textBtn: { paddingVertical: theme.spacing(2), alignItems: "center" },
    textBtnText: { color: theme.colors.muted, fontSize: 14, fontWeight: "600" },
    btnPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
    btnDisabled: { opacity: 0.5 },
  })
