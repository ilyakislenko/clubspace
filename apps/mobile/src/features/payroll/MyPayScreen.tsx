import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import { getMyPayroll, type MyPayroll, type MyPayrollMonth } from "../../shared/api/payroll"
import { useAuth } from "../../shared/auth-context"
import { CenteredColumn, READABLE_WIDTH } from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { errorMessage } from "../../shared/error-message"
import { formatMoney } from "../../shared/format-ru"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { useVocabulary } from "../../shared/use-vocabulary"
import { countsText, currentText, monthFacts, monthLabel, rateText, signedMoney } from "./my-pay"

type Props = NativeStackScreenProps<RootStackParamList, "MyPay">

// The club turned «Мои выплаты» off: its message, nothing to retry.
const isForbidden = (e: unknown): boolean =>
  (e as { response?: { status?: unknown } } | null)?.response?.status === 403

/**
 * «Мои выплаты» (staff, when the club shows them): this month's counts without
 * money, then the closed months — a tap opens the parts, the rate and the
 * adjustments with comments. Plain fetch, never cached: when the club turns it
 * off, no stale sums stay on the phone. A «month closed» push opens its month.
 */
export function MyPayScreen({ route }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const vocabulary = useVocabulary()
  const { workspace } = useAuth()
  const workspaceId = workspace?.workspaceId
  const [data, setData] = useState<MyPayroll | null>(null)
  const [error, setError] = useState<{ message: string; forbidden: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [open, setOpen] = useState<string | null>(route.params?.month ?? null)

  useEffect(() => {
    if (route.params?.month) setOpen(route.params.month)
  }, [route.params?.month])

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      setData(await getMyPayroll({ workspaceId }))
      setError(null)
    } catch (e) {
      const forbidden = isForbidden(e)
      if (forbidden) setData(null)
      setError({ message: errorMessage(e, "Не удалось загрузить выплаты"), forbidden })
    }
  }, [workspaceId])

  useEffect(() => {
    setLoading(true)
    setData(null)
    void load().finally(() => setLoading(false))
  }, [load])

  const refresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  if (!workspace) return null

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.colors.accent} />
          }
        >
          {loading && !data ? (
            <ActivityIndicator color={theme.colors.accent} />
          ) : error && !data ? (
            error.forbidden ? (
              <Text style={styles.muted}>{error.message}</Text>
            ) : (
              <ErrorRetry message={error.message} onRetry={() => void refresh()} />
            )
          ) : data ? (
            <>
              <Text style={styles.current}>{currentText(data.current, vocabulary)}</Text>
              {data.months.length === 0 ? (
                <Text style={styles.muted}>
                  Закрытых месяцев пока нет — клуб закрывает месяц после расчёта.
                </Text>
              ) : (
                <>
                  <View style={styles.list}>
                    {data.months.map((m) => (
                      <MonthRow
                        key={m.month}
                        month={m}
                        currentMonth={data.current.month}
                        expanded={open === m.month}
                        onToggle={() => setOpen((v) => (v === m.month ? null : m.month))}
                      />
                    ))}
                  </View>
                  <Text style={styles.footnote}>Суммы до налогов. Выплату оформляет клуб.</Text>
                </>
              )}
            </>
          ) : null}
        </ScrollView>
      </CenteredColumn>
    </SafeAreaView>
  )
}

function MonthRow({
  month: m,
  currentMonth,
  expanded,
  onToggle,
}: {
  month: MyPayrollMonth
  currentMonth: string
  expanded: boolean
  onToggle: () => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const vocabulary = useVocabulary()
  const label = monthLabel(m.month, currentMonth)
  const total = formatMoney(m.total, m.currency)
  const facts = monthFacts(m, vocabulary)
  return (
    <View style={styles.card}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${label}: ${total}`}
        style={styles.rowHead}
      >
        <Text style={styles.rowTitle}>{label}</Text>
        <Text style={styles.rowTotal}>{total}</Text>
        <Icon name={expanded ? "chevron-up" : "chevron-down"} size={18} color={theme.colors.muted} />
      </Pressable>
      {expanded && (
        <View style={styles.details}>
          {facts.map((f) => (
            <Text key={f} style={styles.detail}>
              {f}
            </Text>
          ))}
          {m.adjustments.map((a) => (
            <Text key={a.id} style={styles.detail}>
              {signedMoney(a.amount, m.currency)} · {a.comment}
            </Text>
          ))}
          <Text style={styles.mutedSmall}>{countsText(m, vocabulary)}</Text>
          <Text style={styles.mutedSmall}>{m.rate ? rateText(m.rate, vocabulary) : "Ставка не задана"}</Text>
        </View>
      )}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    body: { padding: theme.spacing(5), gap: theme.spacing(3) },
    current: { ...theme.typography.bodyStrong, color: theme.colors.text },
    muted: { ...theme.typography.body, color: theme.colors.muted },
    mutedSmall: { ...theme.typography.caption, color: theme.colors.muted },
    footnote: { ...theme.typography.caption, color: theme.colors.muted },
    list: { gap: theme.spacing(2) },
    card: {
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    rowHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      minHeight: 48,
      paddingHorizontal: theme.spacing(3),
    },
    rowTitle: { ...theme.typography.bodyStrong, flex: 1, color: theme.colors.text },
    rowTotal: { ...theme.typography.bodyStrong, color: theme.colors.text },
    details: {
      gap: theme.spacing(1),
      paddingHorizontal: theme.spacing(3),
      paddingBottom: theme.spacing(3),
    },
    detail: { ...theme.typography.body, color: theme.colors.text },
  })
