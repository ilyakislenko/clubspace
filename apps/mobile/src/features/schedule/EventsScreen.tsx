import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useRef, useState } from "react"
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
} from "react-native"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { Pressable } from "../../shared/components/Pressable"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  CenteredColumn,
  DASHBOARD_WIDTH,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ResponsiveGrid } from "../../shared/components/ResponsiveGrid"

import {
  cancelEventRegistration,
  payEventRegistrationOnline,
  registerForEvent,
} from "../../shared/api/event-registrations"
import { listEvents, type ScheduleEvent } from "../../shared/api/groups"
import { showAlert } from "../../shared/alert"
import { useAuth } from "../../shared/auth-context"
import { useToast } from "../../shared/components/Toast"
import { errorMessage } from "../../shared/error-message"
import { haptics } from "../../shared/haptics"
import { isWeb } from "../../shared/platform"
import { useVocabulary } from "../../shared/use-vocabulary"
import { spotsLine } from "./class-booking-helpers"
import { foreignTzSuffix } from "./schedule-helpers"
import { bookedLine, eventViewer, priceLabel } from "./event-helpers"
import { openPaymentPage } from "../payments/open-payment-page"
import { fetchMe } from "../../shared/api/me"
import type { DeltaItem, DeltaOp } from "../../shared/cache/cache-events"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "Events">

const formatRangeInTz = (
  startIso: string,
  endIso: string,
  tz: string,
): string => {
  // Render in the event's OWN timezone — that's the wall-clock the
  // organiser typed and the same string everyone in the club should
  // see. Device locale doesn't enter the picture.
  const start = new Date(startIso)
  const end = new Date(endIso)
  const dateFmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    day: "2-digit",
    month: "short",
  })
  const timeFmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const sameDay = dayKeyFmt.format(start) === dayKeyFmt.format(end)
  if (sameDay) {
    return `${dateFmt.format(start)}, ${timeFmt.format(start)} – ${timeFmt.format(end)}`
  }
  return `${dateFmt.format(start)}, ${timeFmt.format(start)} – ${dateFmt.format(end)}, ${timeFmt.format(end)}`
}

// A master class: price, places and the member's own registration, with
// register / waitlist / cancel, and «Оплатить онлайн» for an unpaid place
// when the club takes payments online. A guardian acting for a child acts for
// it. Its teacher and the staff run it instead: they see how many signed up.
function EventRegistrationBlock({
  event,
  signsUp,
  onChanged,
  onPaymentStarted,
}: {
  event: ScheduleEvent
  signsUp: boolean
  onChanged: () => void
  // The provider's page is open (native: in the browser) — follow the payment.
  onPaymentStarted: (paymentId: string) => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  const reg = event.registration
  if (!reg || !workspace) return null
  const mine = reg.mine
  const capacity = event.capacity ?? null
  const started = new Date(event.startAt).getTime() <= Date.now()
  const full = capacity !== null && reg.booked >= capacity
  const paidOnline = !!mine?.isPaid && mine.paymentMethod === "ONLINE"
  const canPayOnline =
    mine?.status === "BOOKED" && !mine.isPaid && reg.onlinePayment

  if (!signsUp) {
    return (
      <View style={styles.regBlock}>
        <Text style={styles.regPrice}>
          {priceLabel(event.price ?? null, event.currency ?? "RUB")}
        </Text>
        <Text style={styles.regSpots}>
          {bookedLine({ capacity, booked: reg.booked, waitlist: reg.waitlist })}
        </Text>
      </View>
    )
  }

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      haptics.success()
      showToast(done, "success")
      onChanged()
    } catch (e) {
      // The server explains why (started, not a member, …) — as is.
      setError(errorMessage(e, "Не удалось сохранить запись"))
    } finally {
      setBusy(false)
    }
  }

  const register = () =>
    void run(
      () =>
        registerForEvent({
          workspaceId: workspace.workspaceId,
          eventId: event.id,
        }),
      full ? "Вы в листе ожидания" : "Вы записаны",
    )

  const cancel = () => {
    if (!mine) return
    const waiting = mine.status === "WAITLISTED"
    showAlert(
      waiting ? "Покинуть лист ожидания?" : "Отменить запись?",
      waiting
        ? "Место в очереди займёт следующий."
        : "Ваше место перейдёт первому из листа ожидания.",
      [
        { text: "Нет", style: "cancel" },
        {
          text: waiting ? "Покинуть" : "Отменить запись",
          style: "destructive",
          onPress: () =>
            void run(
              () =>
                cancelEventRegistration({
                  workspaceId: workspace.workspaceId,
                  registrationId: mine.id,
                }),
              waiting ? "Вы покинули лист ожидания" : "Запись отменена",
            ),
        },
      ],
    )
  }

  // Same flow as buying an abonement online: the provider's page, then its
  // return URL (/payment/<id>) shows how it went.
  const payOnline = async () => {
    if (!mine || paying) return
    setPaying(true)
    setError(null)
    try {
      const { payment, confirmationUrl } = await payEventRegistrationOnline({
        workspaceId: workspace.workspaceId,
        registrationId: mine.id,
      })
      try {
        await openPaymentPage(confirmationUrl)
        onPaymentStarted(payment.id)
      } catch {
        showToast("Не удалось открыть страницу оплаты", "error")
      }
    } catch (e) {
      // The server explains why (already paid, no place, no provider, …).
      setError(errorMessage(e, "Не удалось начать оплату"))
      onChanged()
    } finally {
      setPaying(false)
    }
  }

  return (
    <View style={styles.regBlock}>
      <Text style={styles.regPrice}>
        {priceLabel(event.price ?? null, event.currency ?? "RUB")}
      </Text>
      <Text style={styles.regSpots}>
        {spotsLine({ capacity, booked: reg.booked, waitlist: reg.waitlist })}
      </Text>
      {mine?.status === "BOOKED" && (
        <Text style={styles.regMine}>
          Вы записаны
          {event.price != null
            ? mine.isPaid
              ? paidOnline
                ? " · оплачено онлайн"
                : " · оплачено"
              : reg.onlinePayment
                ? " · не оплачено"
                : " · оплата в клубе"
            : ""}
        </Text>
      )}
      {mine?.status === "WAITLISTED" && (
        <Text style={styles.regMine}>
          Вы в листе ожидания: {mine.waitlistPosition ?? "—"}-е место в очереди.
          Освободится место — запишем и пришлём уведомление
        </Text>
      )}
      {error && <Text style={styles.regError}>{error}</Text>}
      {canPayOnline && (
        <Pressable
          onPress={() => void payOnline()}
          disabled={paying || busy}
          accessibilityRole="button"
          style={[styles.regButton, styles.regButtonPrimary]}
        >
          {paying ? (
            <ActivityIndicator color={theme.colors.accentText} />
          ) : (
            <Text style={styles.regButtonPrimaryText}>
              Оплатить онлайн ·{" "}
              {priceLabel(event.price ?? null, event.currency ?? "RUB")}
            </Text>
          )}
        </Pressable>
      )}
      {paidOnline && !started && (
        // The money went through the app: the club refunds it.
        <Text style={styles.regSpots}>
          Чтобы отменить запись и вернуть деньги, обратитесь в клуб
        </Text>
      )}
      {!started &&
        !paidOnline &&
        (mine ? (
          <Pressable
            onPress={cancel}
            disabled={busy}
            accessibilityRole="button"
            style={[styles.regButton, styles.regButtonSecondary]}
          >
            <Text style={styles.regButtonSecondaryText}>
              {busy
                ? "Отменяем…"
                : mine.status === "WAITLISTED"
                  ? "Покинуть лист ожидания"
                  : "Отменить запись"}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={register}
            disabled={busy}
            accessibilityRole="button"
            style={[styles.regButton, styles.regButtonPrimary]}
          >
            {busy ? (
              <ActivityIndicator color={theme.colors.accentText} />
            ) : (
              <Text style={styles.regButtonPrimaryText}>
                {full ? "Встать в лист ожидания" : "Записаться"}
              </Text>
            )}
          </Pressable>
        ))}
    </View>
  )
}

export function EventsScreen({ navigation, route }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const vocabulary = useVocabulary()
  const me = useCachedResource(
    workspace ? `me:${workspace.workspaceId}` : null,
    useCallback(async () => await fetchMe(), []),
  )
  const meId = me.data?.id ?? null
  // Opened on one event (Home's «Ближайшее событие»): scroll to its card
  // once both it and the list are laid out, and mark it.
  const focusId = route.params?.eventId ?? null
  const scrollRef = useRef<ScrollViewInstance>(null)
  const listRef = useRef<React.ComponentRef<typeof View>>(null)
  const focusRef = useRef<React.ComponentRef<typeof View>>(null)
  const listY = useRef<number | null>(null)
  const scrolledTo = useRef<string | null>(null)
  const scrollToFocus = () => {
    const card = focusRef.current
    const list = listRef.current
    if (!card || !list || listY.current === null) return
    if (scrolledTo.current === focusId) return
    card.measureLayout(list, (_x, y) => {
      scrolledTo.current = focusId
      scrollRef.current?.scrollTo({
        y: Math.max(0, listY.current! + y - theme.spacing(3)),
        animated: true,
      })
    })
  }
  const {
    data: events,
    error,
    loading,
    refreshing,
    stale,
    refetch,
  } = useCachedResource<ScheduleEvent[]>(
    workspace ? `events:${workspace.workspaceId}` : null,
    useCallback(
      async () =>
        (await listEvents({ workspaceId: workspace!.workspaceId })).data,
      [workspace],
    ),
    {
      // Live event add/edit/remove, kept sorted by start time (server order).
      onDelta: useCallback(
        (list: ScheduleEvent[] | null, op: DeltaOp, item: DeltaItem) => {
          const current = list ?? []
          if (op === "delete") return current.filter((e) => e.id !== item.id)
          // A live edit carries the event without the places: keep them
          // until the refetch the registration change triggers.
          const next =
            op === "update"
              ? current.map((e) =>
                  e.id === item.id ? { ...e, ...(item as ScheduleEvent) } : e,
                )
              : [
                  ...current.filter((e) => e.id !== item.id),
                  item as ScheduleEvent,
                ]
          return [...next].sort((a, b) => a.startAt.localeCompare(b.startAt))
        },
        [],
      ),
    },
  )

  if (!workspace) return null

  if (loading && !events) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={DASHBOARD_WIDTH}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.body}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refetch}
            tintColor={theme.colors.accent}
          />
        }
      >
        <Text style={styles.subtitle}>
          Семинары, открытые {vocabulary.session.nomPl} и спец-классы. Можно заглянуть в другой
          зал, если есть желание.
        </Text>

        {stale && events ? <OfflineNotice /> : null}

        {error && !events ? (
          <ErrorRetry message={error} onRetry={refetch} />
        ) : events && events.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Событий пока нет</Text>
            <Text style={styles.emptyText}>
              Когда {vocabulary.coach.nom} опубликует семинар или открытый ковёр — он
              появится здесь.
            </Text>
          </View>
        ) : (
          <View
            ref={listRef}
            style={styles.list}
            onLayout={(e) => {
              listY.current = e.nativeEvent.layout.y
              scrollToFocus()
            }}
          >
            <ResponsiveGrid>
            {events?.map((event) => (
              <View
                key={event.id}
                ref={event.id === focusId ? focusRef : undefined}
                onLayout={event.id === focusId ? scrollToFocus : undefined}
                style={[styles.card, event.id === focusId && styles.cardFocused]}
              >
                <Text style={styles.cardTitle}>{event.title}</Text>
                <Text style={styles.cardWhen}>
                  {formatRangeInTz(
                    event.startAt,
                    event.endAt,
                    event.timezone,
                  )}
                </Text>
                {/* The event's own clock; its zone only when the phone's differs. */}
                {foreignTzSuffix(event.timezone, new Date(event.startAt)) !== "" && (
                  <Text style={styles.cardTz}>
                    {foreignTzSuffix(event.timezone, new Date(event.startAt)).trim()}
                  </Text>
                )}
                {event.gym && (
                  <Text style={styles.cardWhere} numberOfLines={1}>
                    {event.gym.name} · {event.gym.address}
                  </Text>
                )}
                {(event.hostName || event.coach) && (
                  <Text style={styles.cardCoach} numberOfLines={1}>
                    Ведёт:{" "}
                    {event.hostName ||
                      [event.coach?.firstname, event.coach?.lastname]
                        .filter(Boolean)
                        .join(" ")
                        .trim() ||
                      event.coach?.email}
                  </Text>
                )}
                {event.description && (
                  <Text style={styles.cardDescription}>
                    {event.description}
                  </Text>
                )}
                {event.link && (
                  <Pressable
                    onPress={() => void Linking.openURL(event.link!)}
                    style={styles.linkRow}
                  >
                    <Text style={styles.linkText} numberOfLines={1}>
                      {event.link}
                    </Text>
                  </Pressable>
                )}
                {(() => {
                  const viewer = eventViewer(event, meId, workspace!)
                  return (
                    <>
                      {event.registration && (
                        <EventRegistrationBlock
                          event={event}
                          signsUp={viewer.signsUp}
                          onChanged={refetch}
                          // Web: the provider's page has replaced the app and
                          // its return URL opens the payment screen. Native:
                          // follow it here while the browser is open.
                          onPaymentStarted={(paymentId) => {
                            if (!isWeb) {
                              navigation.navigate("PaymentReturn", { paymentId })
                            }
                          }}
                        />
                      )}
                      {viewer.marks && (
                        <Pressable
                          onPress={() =>
                            navigation.navigate("EventAttendance", {
                              eventId: event.id,
                              title: event.title,
                            })
                          }
                          accessibilityRole="button"
                          style={[styles.regButton, styles.regButtonSecondary]}
                        >
                          <Text style={styles.regButtonSecondaryText}>
                            Отметить пришедших
                          </Text>
                        </Pressable>
                      )}
                    </>
                  )
                })()}
              </View>
            ))}
            </ResponsiveGrid>
          </View>
        )}
      </ScrollView>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  body: {
    padding: theme.spacing(5),
    gap: theme.spacing(3),
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.muted,
  },
  empty: {
    width: "100%",
    maxWidth: READABLE_WIDTH,
    alignSelf: "center",
    alignItems: "center",
    gap: theme.spacing(2),
    padding: theme.spacing(6),
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
  },
  emptyTitle: {
    ...theme.typography.bodyStrong,
    color: theme.colors.text,
    textAlign: "center",
  },
  emptyText: {
    ...theme.typography.caption,
    color: theme.colors.muted,
    textAlign: "center",
  },
  list: { gap: theme.spacing(2) },
  card: {
    flexGrow: 1,
    gap: theme.spacing(1),
    padding: theme.spacing(4),
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.sm,
  },
  cardFocused: {
    borderWidth: 2,
    borderColor: theme.colors.accent,
  },
  cardTitle: {
    ...theme.typography.subheading,
    color: theme.colors.text,
  },
  cardWhen: {
    color: theme.colors.text,
    fontSize: 13,
  },
  cardTz: {
    color: theme.colors.muted,
    fontSize: 11,
    fontFamily: undefined,
  },
  cardWhere: {
    color: theme.colors.muted,
    fontSize: 12,
  },
  cardCoach: {
    color: theme.colors.muted,
    fontSize: 12,
  },
  cardDescription: {
    color: theme.colors.text,
    fontSize: 13,
    marginTop: theme.spacing(1),
  },
  linkRow: {
    marginTop: theme.spacing(1),
  },
  linkText: {
    color: theme.colors.accent,
    fontSize: 12,
  },
  regBlock: {
    marginTop: theme.spacing(2),
    gap: theme.spacing(1),
    paddingTop: theme.spacing(2),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  regPrice: { ...theme.typography.bodyStrong, color: theme.colors.text },
  regSpots: { fontSize: 14, fontWeight: "600", color: theme.colors.text },
  regMine: { fontSize: 13, color: theme.colors.success },
  regError: { fontSize: 13, color: theme.colors.danger },
  regButton: {
    marginTop: theme.spacing(1),
    paddingVertical: theme.spacing(3),
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  regButtonPrimary: { backgroundColor: theme.colors.accent },
  regButtonPrimaryText: {
    color: theme.colors.accentText,
    fontSize: 15,
    fontWeight: "700",
  },
  regButtonSecondary: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  regButtonSecondaryText: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
})
