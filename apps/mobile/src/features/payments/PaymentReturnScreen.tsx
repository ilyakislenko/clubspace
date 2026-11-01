import { useIsFocused } from "@react-navigation/native"
import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import type { MyPayment } from "../../shared/api/payments"
import { useAuth } from "../../shared/auth-context"
import { CenteredColumn, READABLE_WIDTH } from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { Pressable } from "../../shared/components/Pressable"
import { formatMoney } from "../../shared/format-ru"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { toneColor } from "../subscription/subscription-state"
import { paymentStatusLine } from "./payment-helpers"
import { usePaymentPolling } from "./usePaymentPolling"

type Props = NativeStackScreenProps<RootStackParamList, "PaymentReturn">

/**
 * Where the provider's page sends the member back (web: /payment/<id>). Waits
 * for the webhook to settle the payment and says how it went; on success the
 * session is refreshed so a member whose access had expired is let back in.
 */
export function PaymentReturnScreen({ route, navigation }: Props) {
  const { paymentId } = route.params
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace, refresh } = useAuth()
  const focused = useIsFocused()

  const handleSettled = useCallback(
    (payment: MyPayment) => {
      if (payment.status === "SUCCEEDED") void refresh()
    },
    [refresh],
  )

  const { payment, error, timedOut, recheck } = usePaymentPolling({
    workspaceId: workspace?.workspaceId ?? null,
    paymentId,
    enabled: focused,
    onSettled: handleSettled,
  })

  if (!workspace) return null

  const line = payment ? paymentStatusLine(payment) : null
  const pending = payment?.status === "PENDING"

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <View style={styles.body}>
          {!payment && error ? (
            <ErrorRetry message={error} onRetry={recheck} />
          ) : !payment || !line ? (
            <ActivityIndicator color={theme.colors.accent} />
          ) : (
            <View style={styles.card}>
              <View style={styles.statusRow}>
                {pending && !timedOut && (
                  <ActivityIndicator color={theme.colors.accent} />
                )}
                <Text
                  style={[
                    styles.status,
                    { color: toneColor(theme.colors, line.tone) },
                  ]}
                >
                  {line.text}
                </Text>
              </View>
              <Text style={styles.meta}>
                {payment.planName} · {formatMoney(payment.amount, payment.currency)}
              </Text>
              {pending && (
                <Text style={styles.meta}>
                  {timedOut
                    ? "Подтверждение задерживается. Если деньги списались, абонемент появится чуть позже — или напишите администратору клуба."
                    : "Обычно это занимает несколько секунд после оплаты."}
                </Text>
              )}
              {payment.status === "CANCELED" && (
                <Text style={styles.meta}>
                  Деньги не списаны. Оплатить можно ещё раз на экране абонемента.
                </Text>
              )}
              {pending && timedOut && (
                <Pressable
                  onPress={recheck}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.secondaryBtn,
                    pressed && styles.btnPressed,
                  ]}
                >
                  <Text style={styles.secondaryBtnText}>Проверить ещё раз</Text>
                </Pressable>
              )}
            </View>
          )}

          <Pressable
            onPress={() => navigation.replace("MySubscription")}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && styles.btnPressed,
            ]}
          >
            <Text style={styles.primaryBtnText}>К абонементу</Text>
          </Pressable>
        </View>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    body: { padding: theme.spacing(5), gap: theme.spacing(4) },
    card: {
      padding: theme.spacing(4),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: theme.spacing(1),
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
    },
    status: { flex: 1, fontSize: 16, fontWeight: "700" },
    meta: { color: theme.colors.muted, fontSize: 13 },
    primaryBtn: {
      backgroundColor: theme.colors.accent,
      paddingVertical: theme.spacing(4),
      borderRadius: theme.radius.full,
      alignItems: "center",
      ...theme.shadows.sm,
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
    btnPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  })
