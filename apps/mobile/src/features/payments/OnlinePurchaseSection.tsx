import React, { useCallback, useEffect, useRef, useState } from "react"
import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import {
  createPayment,
  getCheckoutQuote,
  getOnlinePurchaseOptions,
  type CheckoutQuote,
  type MyPayment,
  type OnlinePlan,
  type OnlinePurchaseOptions,
} from "../../shared/api/payments"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { Pressable } from "../../shared/components/Pressable"
import { useToast, type ToastVariant } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import { formatMoney } from "../../shared/format-ru"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  AbonementScopeChips,
  hasScoped,
} from "../subscription/AbonementScopeChips"
import { toneColor } from "../subscription/subscription-state"
import {
  offerPrice,
  onlinePlanOffer,
  PENDING_TEXT,
  PROMO_DEFERRED_NOTE,
  paymentStatusLine,
  planTermsText,
  promoQuotePlan,
  renewalNote,
} from "./payment-helpers"
import { OfferPriceText } from "./OfferPriceText"
import { openPaymentPage } from "./open-payment-page"
import { PromoCodeField } from "./PromoCodeField"
import { usePaymentPolling } from "./usePaymentPolling"

// A promo code as applied: the server's quote per tariff (by id).
type AppliedPromo = { code: string; quotes: Record<string, CheckoutQuote> }

type Props = {
  workspaceId: string
  // False while the host screen is covered: the pending payment isn't polled.
  active: boolean
  // Bump to re-read the options (the host's pull-to-refresh).
  reloadKey?: number
  // A payment to follow from the start (the provider's return URL).
  initialPaymentId?: string | null
  // The payment went through: the host re-reads the abonement / access.
  onPaid: () => void
}

const toastVariant = (p: MyPayment): ToastVariant =>
  p.status === "CANCELED"
    ? "error"
    : p.status === "SUCCEEDED" && !p.activationError
      ? "success"
      : "default"

/**
 * «Оплатить онлайн»: the club's online tariffs with a pay button each, the
 * pending payment while the provider's webhook is awaited, and the outcome.
 * Hidden entirely when the club takes no online payments and nothing is
 * pending. Shown on the abonement screen and on the expired-access lock
 * screen (the endpoints stay open to an expired member).
 */
export function OnlinePurchaseSection({
  workspaceId,
  active,
  reloadKey,
  initialPaymentId,
  onPaid,
}: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { showToast } = useToast()

  const [options, setOptions] = useState<OnlinePurchaseOptions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [trackedId, setTrackedId] = useState<string | null>(
    initialPaymentId ?? null,
  )
  const [outcome, setOutcome] = useState<MyPayment | null>(null)
  const [buyingId, setBuyingId] = useState<string | null>(null)
  const [promo, setPromo] = useState<AppliedPromo | null>(null)
  const [promoNote, setPromoNote] = useState<string | null>(null)
  const [quoting, setQuoting] = useState(false)
  // More tariffs than «Применить» quotes at once: the rest are quoted on
  // their own «Оплатить».
  const [promoDeferred, setPromoDeferred] = useState(false)
  // Bumped by every apply / edit: a quote that comes back after the code
  // changed is dropped.
  const promoRun = useRef(0)

  const load = useCallback(async () => {
    try {
      const next = await getOnlinePurchaseOptions({ workspaceId })
      setOptions(next)
      setError(null)
      const pendingId = next.pendingPayment?.id
      if (pendingId) setTrackedId((current) => current ?? pendingId)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить онлайн-оплату"))
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const handleSettled = useCallback(
    (payment: MyPayment) => {
      setOutcome(payment)
      setTrackedId(null)
      showToast(paymentStatusLine(payment).text, toastVariant(payment))
      if (payment.status === "SUCCEEDED") onPaid()
      void load()
    },
    [load, onPaid, showToast],
  )

  const polling = usePaymentPolling({
    workspaceId,
    paymentId: trackedId,
    enabled: active,
    onSettled: handleSettled,
  })

  const applyPromo = async (code: string) => {
    if (!options) return
    const run = ++promoRun.current
    const { batches, deferred } = promoQuotePlan(options.plans.map((p) => p.id))
    setQuoting(true)
    setPromo(null)
    setPromoNote(null)
    setPromoDeferred(false)
    try {
      const quotes: Record<string, CheckoutQuote> = {}
      for (const batch of batches) {
        const got = await Promise.all(
          batch.map((planId) =>
            getCheckoutQuote({ workspaceId, planId, promoCode: code }),
          ),
        )
        if (run !== promoRun.current) return
        batch.forEach((planId, i) => {
          quotes[planId] = got[i]
        })
      }
      setPromo({ code, quotes })
      setPromoDeferred(deferred)
      // One reason for every quoted tariff («не найден», «закончился») goes
      // under the field; reasons that differ stay on their cards.
      const list = Object.values(quotes)
      const notes = new Set(list.map((q) => q.promoCodeNote))
      const applied = list.some((q) => q.discount?.code)
      const [only] = [...notes]
      setPromoNote(!applied && notes.size === 1 ? only : null)
    } catch (e) {
      if (run !== promoRun.current) return
      setPromoNote(errorMessage(e, "Не удалось проверить промокод"))
    } finally {
      if (run === promoRun.current) setQuoting(false)
    }
  }

  const editPromo = () => {
    promoRun.current++
    setQuoting(false)
    setPromo(null)
    setPromoNote(null)
    setPromoDeferred(false)
  }

  // A tariff past the ones «Применить» quoted: its first «Оплатить» quotes
  // it with the code and shows the price; the next tap pays that price.
  const quoteOne = async (plan: OnlinePlan, code: string) => {
    const run = promoRun.current
    setBuyingId(plan.id)
    try {
      const quote = await getCheckoutQuote({
        workspaceId,
        planId: plan.id,
        promoCode: code,
      })
      if (run !== promoRun.current) return
      setPromo((p) => p && { ...p, quotes: { ...p.quotes, [plan.id]: quote } })
    } catch (e) {
      showToast(errorMessage(e, "Не удалось проверить промокод"), "error")
    } finally {
      setBuyingId(null)
    }
  }

  const pay = async (plan: OnlinePlan) => {
    if (buyingId) return
    if (promo && !promo.quotes[plan.id]) return quoteOne(plan, promo.code)
    setBuyingId(plan.id)
    // Sent only where the quote shows it: a code the server can't use on
    // this tariff would be refused.
    const promoCode = promo?.quotes[plan.id]?.discount?.code
      ? promo.code
      : undefined
    try {
      const { payment, confirmationUrl } = await createPayment({
        workspaceId,
        data: { planId: plan.id, ...(promoCode ? { promoCode } : {}) },
      })
      setOutcome(null)
      setTrackedId(payment.id)
      try {
        await openPaymentPage(confirmationUrl)
      } catch {
        showToast("Не удалось открыть страницу оплаты", "error")
      }
    } catch (e) {
      showToast(errorMessage(e, "Не удалось начать оплату"), "error")
      // The refusal may come from a state the block doesn't show yet.
      void load()
    } finally {
      setBuyingId(null)
    }
  }

  if (error && !options) {
    return <ErrorRetry message={error} onRetry={() => void load()} />
  }
  if (!options) return null

  // The payment being followed, as last read (or as the options listed it).
  const tracked =
    trackedId === null
      ? null
      : (polling.payment ??
        (options.pendingPayment?.id === trackedId ? options.pendingPayment : null))
  const pending =
    trackedId !== null && (tracked === null || tracked.status === "PENDING")

  if (!options.available && !pending && !outcome) return null

  const outcomeLine = outcome ? paymentStatusLine(outcome) : null

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Оплатить онлайн</Text>

      {pending && (
        <View style={styles.card}>
          <View style={styles.pendingRow}>
            {!polling.timedOut && !polling.error && (
              <ActivityIndicator color={theme.colors.accent} />
            )}
            <Text style={styles.pendingText}>{PENDING_TEXT}</Text>
          </View>
          {tracked && (
            <Text style={styles.meta}>
              {tracked.planName} · {formatMoney(tracked.amount, tracked.currency)}
            </Text>
          )}
          {polling.error ? (
            <Text style={styles.danger}>{polling.error}</Text>
          ) : polling.timedOut ? (
            <Text style={styles.meta}>
              Подтверждение задерживается. Если деньги списались, абонемент
              появится чуть позже — или напишите администратору клуба.
            </Text>
          ) : (
            <Text style={styles.meta}>
              Обычно это занимает несколько секунд после оплаты.
            </Text>
          )}
          {(polling.error || polling.timedOut) && (
            <Pressable
              onPress={polling.recheck}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.secondaryBtn,
                pressed && styles.btnPressed,
              ]}
            >
              <Text style={styles.secondaryBtnText}>Проверить ещё раз</Text>
            </Pressable>
          )}
          {options.available && !options.blockedReason && (
            <Text style={styles.meta}>
              Если страница оплаты закрылась, нажмите «Оплатить» у того же
              тарифа ещё раз.
            </Text>
          )}
        </View>
      )}

      {!pending && outcome && outcomeLine && (
        <View style={styles.card}>
          <Text
            style={[
              styles.outcomeText,
              { color: toneColor(theme.colors, outcomeLine.tone) },
            ]}
          >
            {outcomeLine.text}
          </Text>
          {outcome.status === "CANCELED" && options.available && (
            <Text style={styles.meta}>Можно попробовать ещё раз.</Text>
          )}
        </View>
      )}

      {options.available && (
        <>
          {options.renewalFrom && (
            <Text style={styles.meta}>{renewalNote(options.renewalFrom)}</Text>
          )}
          {options.blockedReason && (
            <Text style={styles.blocked}>{options.blockedReason}</Text>
          )}
          {options.plans.map((plan) => {
            const quote = promo?.quotes[plan.id]
            const offer = quote
              ? offerPrice({
                  listPrice: quote.listPrice,
                  amount: quote.amount,
                  currency: quote.currency,
                  discount: quote.discount,
                })
              : onlinePlanOffer(plan)
            // Why the code left this tariff's price as is, when the reason
            // isn't already under the field.
            const cardNote = promoNote === null ? quote?.promoCodeNote : null
            return (
              <View key={plan.id} style={styles.card}>
                <View style={styles.planHead}>
                  <Text style={styles.planName}>{plan.name}</Text>
                  <OfferPriceText offer={offer} style={styles.price} />
                </View>
                {offer.note && (
                  <Text style={styles.discount}>{offer.note}</Text>
                )}
                {cardNote && <Text style={styles.promoNote}>{cardNote}</Text>}
                {/* The server offers only tariffs of the member's directions
                    plus club-wide ones; the chips say which is which. */}
                <AbonementScopeChips
                  directions={plan.directions}
                  showClubWide={hasScoped(options.plans)}
                />
                <Text style={styles.meta}>{planTermsText(plan)}</Text>
                {plan.description ? (
                  <Text style={styles.description}>{plan.description}</Text>
                ) : null}
                {!options.blockedReason && (
                  <Pressable
                    onPress={() => void pay(plan)}
                    disabled={buyingId !== null}
                    accessibilityRole="button"
                    accessibilityLabel={`Оплатить ${plan.name}`}
                    style={({ pressed }) => [
                      styles.primaryBtn,
                      pressed && styles.btnPressed,
                      buyingId !== null &&
                        buyingId !== plan.id &&
                        styles.btnDisabled,
                    ]}
                  >
                    {buyingId === plan.id ? (
                      <ActivityIndicator color={theme.colors.accentText} />
                    ) : (
                      <Text style={styles.primaryBtnText}>
                        Оплатить {offer.amount}
                      </Text>
                    )}
                  </Pressable>
                )}
              </View>
            )
          })}
          {!options.blockedReason && options.plans.length > 0 && (
            <PromoCodeField
              busy={quoting}
              note={promoNote}
              onApply={(code) => void applyPromo(code)}
              onEdit={editPromo}
            />
          )}
          {promoDeferred && (
            <Text style={styles.meta}>{PROMO_DEFERRED_NOTE}</Text>
          )}
          <Text style={styles.hint}>
            Оплата проходит на защищённой странице платёжного сервиса, деньги
            поступают клубу.
          </Text>
        </>
      )}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { gap: theme.spacing(2) },
    title: {
      ...theme.typography.bodyStrong,
      color: theme.colors.text,
    },
    card: {
      padding: theme.spacing(4),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: theme.spacing(1),
    },
    pendingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
    },
    pendingText: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
    outcomeText: { fontSize: 15, fontWeight: "700" },
    planHead: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "baseline",
      gap: theme.spacing(2),
    },
    planName: {
      flex: 1,
      color: theme.colors.text,
      fontSize: 16,
      fontWeight: "700",
    },
    price: { color: theme.colors.accent, fontSize: 16, fontWeight: "700" },
    meta: { color: theme.colors.muted, fontSize: 13 },
    discount: { color: theme.colors.success, fontSize: 13, fontWeight: "600" },
    // The warning tone, as under the promo code field.
    promoNote: { color: theme.colors.accent, fontSize: 13 },
    description: { color: theme.colors.text, fontSize: 13 },
    danger: { color: theme.colors.danger, fontSize: 13 },
    blocked: { color: theme.colors.accent, fontSize: 14, fontWeight: "600" },
    hint: { color: theme.colors.muted, fontSize: 12 },
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
    btnPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
    btnDisabled: { opacity: 0.5 },
  })
