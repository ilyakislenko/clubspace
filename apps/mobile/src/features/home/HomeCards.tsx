import { agree, cap } from "@clubspace/ui-kit/brand"
import React, { useState, type ReactNode } from "react"
import { StyleSheet, Text, View } from "react-native"

import type { Announcement } from "../../shared/api/announcements"
import type { ClassBooking } from "../../shared/api/class-bookings"
import type { DropInBooking } from "../../shared/api/drop-ins"
import type { MyGroup } from "../../shared/api/groups"
import type { PendingFreezeRequest } from "../../shared/api/member-subscriptions"
import type { PersonalTraining } from "../../shared/api/personal-trainings"
import type { MySubscription } from "../../shared/api/subscriptions"
import { Chevron } from "../../shared/components/Chevron"
import { Icon } from "../../shared/components/Icon"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { formatRuDayRange, pluralRu } from "../../shared/format-ru"
import { useVocabulary } from "../../shared/use-vocabulary"
import { useResponsive } from "../../shared/useResponsive"
import {
  findNextAcrossGroups,
  formatDuration,
  formatNextSessionLabel,
  formatUpcomingLabel,
  type NextAcrossGroups,
} from "../schedule/schedule-helpers"
import type { RecentEntry } from "../profile/preferences-store"
import {
  COACH_TODAY_ROWS,
  canMarkClassNow,
  coachNextLine,
  coachTodayView,
  eventStatusLine,
  formatEventWhen,
  isClassInProgress,
  pickNextTraining,
  type CoachClassToday,
  type MyNextEvent,
} from "./home-helpers"
import {
  abonementShortLine,
  currentAbonements,
  fmtDate,
  freezeLine,
  freezePhase,
  mySubscriptionState,
  soonestEndingId,
  toneColor,
  type AccessVariant,
} from "../subscription/subscription-state"

// A tappable (or plain) summary card. `onPress` adds the chevron. One card on
// Home is `prominent` (the role's main block: the coach's today, the member's
// next class) — elevated, with a heading; the rest are quiet and lead with
// their fact instead of a label. It grows to its grid cell's height so a row
// of cards lines up; `grow={false}` where there is no row to match (a column
// next to taller content would otherwise stretch it to that height — Yoga's
// legacy flexGrow behaviour).
export function HomeCard({
  title,
  onPress,
  children,
  accessibilityLabel,
  grow = true,
  prominent = false,
}: {
  title?: string
  onPress?: () => void
  children: ReactNode
  accessibilityLabel?: string
  grow?: boolean
  prominent?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  const style = [
    styles.card,
    prominent ? styles.cardProminent : styles.cardQuiet,
    !grow && styles.cardNoGrow,
  ]
  const body = (
    <>
      <View style={styles.cardText}>
        {title ? (
          <Text style={prominent ? styles.cardHeading : styles.cardTitle}>
            {title}
          </Text>
        ) : null}
        {children}
      </View>
      {onPress && <Chevron style={styles.chev} />}
    </>
  )
  if (!onPress) return <View style={style}>{body}</View>
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={style}
    >
      {body}
    </Pressable>
  )
}

/** Club access window running out / over, for clubs without abonements. */
export function AccessBanner({
  variant,
  days,
  accessUntil,
}: {
  variant: Exclude<AccessVariant, "ok">
  days: number
  accessUntil: string
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View
      style={[
        styles.banner,
        variant === "expired" ? styles.bannerDanger : styles.bannerWarn,
      ]}
    >
      <Text style={styles.bannerTitle}>
        {variant === "expired"
          ? "Доступ закончился"
          : `Доступ истекает через ${days} дн.`}
      </Text>
      <Text style={styles.bannerText}>
        {variant === "expired"
          ? `Срок: ${fmtDate(accessUntil)}. Свяжитесь с администратором клуба, чтобы продлить.`
          : `До ${fmtDate(accessUntil)}. Свяжитесь с администратором клуба заранее.`}
      </Text>
    </View>
  )
}

/**
 * The soonest class: across the member's groups, a guest booking, a place in
 * a «Запись на занятие» class or a personal session. `prominent` when it is
 * the viewer's main block (a member, not a coach who also trains).
 */
export function NextClassCard({
  groups,
  bookings,
  classBookings,
  personal,
  onPress,
  prominent,
}: {
  groups: MyGroup[]
  bookings: DropInBooking[]
  classBookings: readonly ClassBooking[]
  // Confirmed sessions where the viewer is the student.
  personal: PersonalTraining[]
  onPress: () => void
  prominent?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  const { sizeClass } = useResponsive()
  const vocabulary = useVocabulary()
  const title = `${agree(vocabulary.session, "Ближайшая", "Ближайшее")} ${vocabulary.session.nom}`
  const now = new Date()
  const found = pickNextTraining(
    findNextAcrossGroups(groups, now),
    bookings,
    now,
    personal,
    classBookings,
  )

  if (!found) {
    if (groups.length === 0) {
      return (
        <HomeCard title={title} prominent={prominent}>
          <Text style={styles.muted}>
            Вас пока не добавили в группу — это делает {vocabulary.coach.nom} или администратор
            клуба.
          </Text>
        </HomeCard>
      )
    }
    return (
      <HomeCard title={title} prominent={prominent} onPress={onPress}>
        <Text style={styles.muted}>
          В ближайшие две недели {vocabulary.session.genPl} нет.
        </Text>
      </HomeCard>
    )
  }
  if (found.kind === "personal") {
    const { training } = found
    const label = formatUpcomingLabel(found.startAt, training.timezone, now)
    return (
      <HomeCard
        title={title}
        prominent={prominent}
        onPress={onPress}
        accessibilityLabel={`${title}: ${label}, ${vocabulary.personalSession.nom}`}
      >
        <Text
          style={sizeClass === "expanded" ? styles.strongLarge : styles.strong}
        >
          {label}
        </Text>
        <Text style={styles.line}>{cap(vocabulary.personalSession.nom)}</Text>
        <Text style={styles.muted}>
          {cap(vocabulary.coach.nom)}: {training.coach.displayName}
          {training.gym ? ` · ${training.gym.name}` : ""}
        </Text>
      </HomeCard>
    )
  }
  if (found.kind === "dropin") {
    const { booking } = found
    const label = formatUpcomingLabel(found.startAt, booking.timezone, now)
    return (
      <HomeCard
        title={title}
        prominent={prominent}
        onPress={onPress}
        accessibilityLabel={`${title}: ${label}, ${booking.groupName}, гостевой визит`}
      >
        <Text
          style={sizeClass === "expanded" ? styles.strongLarge : styles.strong}
        >
          {label}
        </Text>
        <Text style={styles.line}>{booking.groupName} · гостевой визит</Text>
        <Text style={styles.muted}>
          {[booking.gym?.name, formatDuration(booking.durationMin)]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </HomeCard>
    )
  }
  if (found.kind === "classBooking") {
    const { booking } = found
    const label = formatUpcomingLabel(found.startAt, booking.timezone, now)
    const minutes = Math.round(
      (new Date(booking.endAt).getTime() - found.startAt.getTime()) / 60_000,
    )
    return (
      <HomeCard
        title={title}
        prominent={prominent}
        onPress={onPress}
        accessibilityLabel={`${title}: ${label}, ${booking.groupName}, вы записаны`}
      >
        <Text
          style={sizeClass === "expanded" ? styles.strongLarge : styles.strong}
        >
          {label}
        </Text>
        <Text style={styles.line}>{booking.groupName} · вы записаны</Text>
        <Text style={styles.muted}>
          {[booking.gym?.name, formatDuration(minutes)]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </HomeCard>
    )
  }
  const { next, group } = found
  return (
    <HomeCard
      title={title}
      prominent={prominent}
      onPress={onPress}
      accessibilityLabel={`${title}: ${formatNextSessionLabel(next)}, ${group.name}`}
    >
      <Text
        style={sizeClass === "expanded" ? styles.strongLarge : styles.strong}
      >
        {formatNextSessionLabel(next)}
      </Text>
      <Text style={styles.line}>{group.name}</Text>
      <Text style={styles.muted}>
        {[group.gym?.name, formatDuration(next.slot.durationMin)]
          .filter(Boolean)
          .join(" · ")}
      </Text>
    </HomeCard>
  )
}

/** The soonest event the member signed up for or waits on; tap opens it. */
export function NextEventCard({
  next,
  onPress,
  grow,
}: {
  next: MyNextEvent
  onPress: () => void
  grow?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  const { sizeClass } = useResponsive()
  const { event, mine } = next
  const title = "Ближайшее событие"
  const when = formatEventWhen(new Date(event.startAt), event.timezone, new Date())
  const status = eventStatusLine(
    mine,
    event.price,
    event.registration?.onlinePayment ?? false,
  )
  return (
    <HomeCard
      title={title}
      onPress={onPress}
      grow={grow}
      accessibilityLabel={`${title}: ${event.title}, ${when}, ${status}`}
    >
      <Text
        style={sizeClass === "expanded" ? styles.strongLarge : styles.strong}
      >
        {when}
      </Text>
      <Text style={styles.line}>{event.title}</Text>
      <Text style={styles.muted}>
        {[status, event.gym?.name].filter(Boolean).join(" · ")}
      </Text>
    </HomeCard>
  )
}

/** A coach's personal-training requests waiting for an answer. */
export function PersonalRequestsCard({
  count,
  onPress,
}: {
  count: number
  onPress: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  const vocabulary = useVocabulary()
  return (
    <HomeCard onPress={onPress}>
      <Text style={styles.strong}>
        {count} {pluralRu(count, "заявка", "заявки", "заявок")} на{" "}
        {vocabulary.personalSession.nomPl}{" "}
        {pluralRu(count, "ждёт", "ждут", "ждут")} ответа
      </Text>
    </HomeCard>
  )
}

const FREEZE_REQUEST_ROWS = 3

/** Members' freeze requests waiting for the viewer's decision. */
export function FreezeRequestsCard({
  requests,
  onOpen,
}: {
  requests: PendingFreezeRequest[]
  onOpen: (userId: string) => void
}) {
  const styles = useThemedStyles(makeStyles)
  const count = requests.length
  return (
    <HomeCard>
      <Text style={styles.strong}>
        {count}{" "}
        {pluralRu(
          count,
          "заявка на заморозку ждёт",
          "заявки на заморозку ждут",
          "заявок на заморозку ждут",
        )}{" "}
        ответа
      </Text>
      {requests.slice(0, FREEZE_REQUEST_ROWS).map((r) => (
        <Pressable
          key={r.id}
          onPress={() => onOpen(r.userId)}
          accessibilityRole="button"
          accessibilityLabel={`Заявка на заморозку: ${r.memberName}`}
        >
          <Text style={styles.line} numberOfLines={1}>
            {r.memberName} · {formatRuDayRange(r.fromDate, r.untilDate)}
          </Text>
        </Pressable>
      ))}
      {count > FREEZE_REQUEST_ROWS && (
        <Text style={styles.muted}>и ещё {count - FREEZE_REQUEST_ROWS}</Text>
      )}
    </HomeCard>
  )
}

/**
 * «Сегодня вы ведёте»: the coach's own classes today and the ones they run
 * as a substitute. The class on now and the next ones (at most three); the
 * finished ones fold into «Прошло: N». «Отметить» only on a class that has
 * started or starts within half an hour; the others open on a tap all the
 * same. `onAll` opens today's schedule when more classes follow; without it
 * (no club schedule) the rest unfold in place. With nothing left to run
 * today, `next` (the next own class on a later day) becomes the block's
 * «Следующая — …» line instead of a separate «Ближайшая» card.
 */
export function CoachTodayCard({
  classes,
  now,
  next,
  onOpen,
  onAll,
  onNext,
  grow,
}: {
  classes: CoachClassToday[]
  now: Date
  next: NextAcrossGroups | null
  onOpen: (c: CoachClassToday) => void
  onAll?: () => void
  onNext: () => void
  grow?: boolean
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const vocabulary = useVocabulary()
  const [showFinished, setShowFinished] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const view = coachTodayView(
    classes,
    now,
    showAll ? classes.length : COACH_TODAY_ROWS,
  )
  const finishedCount = view.finished.length
  // More classes than the rows: today's schedule, or (no schedule) unfold.
  const footer = onAll
    ? view.hidden > 0 && {
        label: `Все ${vocabulary.session.nomPl} сегодня (${classes.length}) →`,
        onPress: onAll,
      }
    : (view.hidden > 0 || showAll) &&
      classes.length - finishedCount > COACH_TODAY_ROWS && {
        label: showAll ? "Свернуть" : `Ещё ${view.hidden}`,
        onPress: () => setShowAll((v) => !v),
      }

  const row = (c: CoachClassToday) => {
    const mark = canMarkClassNow(c, now)
    const live = isClassInProgress(c, now)
    // The gym alone: the city and address live on the class's own screen.
    const sub = [c.gymName, c.note].filter(Boolean).join(" · ")
    return (
      <Pressable
        key={c.key}
        onPress={() => onOpen(c)}
        accessibilityRole="button"
        accessibilityLabel={`${mark ? "Отметить" : "Открыть"}: ${c.startTime}, ${c.groupName}${sub ? `, ${sub}` : ""}${live ? ", идёт сейчас" : ""}`}
        style={styles.classRow}
      >
        <View style={styles.classBody}>
          <View style={styles.classLine}>
            <Text style={[styles.classTime, live && styles.classTimeLive]}>
              {c.startTime}
            </Text>
            <Text style={styles.classTitle} numberOfLines={1}>
              {c.groupName}
            </Text>
          </View>
          {sub ? (
            <Text style={styles.classSub} numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </View>
        {mark ? (
          <View style={styles.markButton}>
            <Text style={styles.markButtonText}>Отметить</Text>
          </View>
        ) : (
          <Chevron style={styles.chev} />
        )}
      </Pressable>
    )
  }

  const nextText = next && coachNextLine(next, vocabulary.session)
  const nextRow = nextText && (
    <Pressable
      onPress={onNext}
      accessibilityRole="button"
      style={styles.classRow}
    >
      <Text style={[styles.classTitle, styles.nextLine]} numberOfLines={2}>
        {nextText}
      </Text>
      <Chevron style={styles.chev} />
    </Pressable>
  )

  return (
    <HomeCard
      title={
        classes.length === 0
          ? `Сегодня ${vocabulary.session.genPl} нет`
          : "Сегодня вы ведёте"
      }
      prominent
      grow={grow}
    >
      {classes.length === 0 ? (
        nextRow
      ) : (
        <>
          {view.rows.map(row)}
          {view.rows.length === 0 &&
            (nextRow || (
              <Text style={styles.muted}>
                На сегодня все {vocabulary.session.nomPl} позади
              </Text>
            ))}
          {footer && (
            <Pressable
              onPress={footer.onPress}
              accessibilityRole="button"
              style={styles.footerLink}
            >
              <Text style={styles.link}>{footer.label}</Text>
            </Pressable>
          )}
          {finishedCount > 0 && (
            <Pressable
              onPress={() => setShowFinished((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={`Прошло: ${finishedCount}`}
              accessibilityState={{ expanded: showFinished }}
              style={styles.finishedToggle}
            >
              <Text style={styles.muted}>Прошло: {finishedCount}</Text>
              <Icon
                name={showFinished ? "chevron-up" : "chevron-down"}
                size={14}
                color={theme.colors.muted}
              />
            </Pressable>
          )}
          {showFinished && view.finished.map(row)}
        </>
      )}
    </HomeCard>
  )
}

/**
 * Plan, state line and visits left. With several current abonements: the
 * access line, then one compact row per abonement (name + what is left), the
 * one ending first in bold.
 */
export function SubscriptionCard({
  data,
  onPress,
  grow,
}: {
  data: MySubscription
  onPress: () => void
  grow?: boolean
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const vocabulary = useVocabulary()
  const state = mySubscriptionState(data, vocabulary)
  const abonements = currentAbonements(data)
  if (abonements.length > 1) {
    const soonest = soonestEndingId(abonements)
    return (
      <HomeCard title="Абонементы" onPress={onPress} grow={grow}>
        <Text style={[styles.line, { color: toneColor(theme.colors, state.tone) }]}>
          {state.text}
        </Text>
        {abonements.map((a) => {
          // Per render: Home is a tab and stays mounted.
          const frozen = a.freeze !== null && freezePhase(a.freeze) === "current"
          const left = a.classesRemaining !== null && a.classesRemaining <= 1
          return (
            <View key={a.id} style={styles.abonementRow}>
              <Text
                style={a.id === soonest ? styles.strong : styles.line}
                numberOfLines={1}
              >
                {a.planName}
              </Text>
              <Text
                style={[
                  styles.muted,
                  (frozen || left || a.isPaid === false) && {
                    color: toneColor(theme.colors, "warn"),
                  },
                ]}
              >
                {[
                  abonementShortLine(a, vocabulary),
                  frozen ? "заморожен" : null,
                  a.isPaid === false ? "ожидает оплаты" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
          )
        })}
      </HomeCard>
    )
  }
  const current = abonements[0] ?? null
  const freeze = current?.freeze ?? null
  // Per render: Home is a tab and stays mounted. A current freeze is already
  // the state line; only an upcoming one needs its own line.
  const upcomingFreeze =
    freeze && freezePhase(freeze) === "upcoming" ? freezeLine(freeze) : null
  return (
    <HomeCard title="Абонемент" onPress={onPress} grow={grow}>
      {current && <Text style={styles.strong}>{current.planName}</Text>}
      <Text style={[styles.line, { color: toneColor(theme.colors, state.tone) }]}>
        {state.text}
      </Text>
      {upcomingFreeze && <Text style={styles.muted}>{upcomingFreeze}</Text>}
      {current?.isPaid === false && (
        <Text style={[styles.line, { color: toneColor(theme.colors, "warn") }]}>
          Ожидает оплаты
        </Text>
      )}
      {/* The state line already says how many are left; the bar shows how
          much of the pack that is. */}
      {current?.classesRemaining != null && current.classesTotal ? (
        <View
          style={styles.bar}
          accessibilityLabel={`Осталось ${current.classesRemaining} из ${current.classesTotal}`}
        >
          <View
            style={[
              styles.barFill,
              {
                width: `${Math.max(0, Math.min(1, current.classesRemaining / current.classesTotal)) * 100}%`,
                backgroundColor:
                  state.tone === "danger"
                    ? theme.colors.danger
                    : state.tone === "warn"
                      ? theme.colors.warning
                      : theme.colors.accent,
              },
            ]}
          />
        </View>
      ) : null}
    </HomeCard>
  )
}

/** The newest (pinned first) announcement, while it is news. */
export function AnnouncementCard({
  item,
  onPress,
  grow,
}: {
  item: Announcement
  onPress: () => void
  grow?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <HomeCard
      title={item.pinned ? "Закреплённое объявление" : "Объявление"}
      onPress={onPress}
      grow={grow}
    >
      <Text style={styles.strong} numberOfLines={2}>
        {item.title}
      </Text>
      <Text style={styles.muted} numberOfLines={1}>
        {item.body}
      </Text>
    </HomeCard>
  )
}

/** «Повторение» with cards due today (Home shows it only then). */
export function ReviewsCard({
  due,
  onPress,
  grow,
}: {
  due: number
  onPress: () => void
  grow?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  const line = `Пора повторить: ${due} ${pluralRu(due, "карточку", "карточки", "карточек")}`
  return (
    <HomeCard onPress={onPress} grow={grow} accessibilityLabel={line}>
      <Text style={styles.strong}>{line}</Text>
    </HomeCard>
  )
}

/**
 * Resume the last video; «Все» when there's more than one to continue.
 * `prominent` when it is a member's main block (no next class to show).
 */
export function ContinueRow({
  recent,
  count,
  onOpen,
  onAll,
  prominent,
}: {
  recent: RecentEntry
  count: number
  onOpen: () => void
  onAll: () => void
  prominent?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.continueWrap}>
      <View style={styles.continueHeader}>
        <Text style={prominent ? styles.cardHeading : styles.cardTitle}>
          Продолжить просмотр
        </Text>
        {count > 1 && (
          <Pressable
            onPress={onAll}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Все недавние видео"
          >
            <Text style={styles.link}>Все</Text>
          </Pressable>
        )}
      </View>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Продолжить: ${recent.title}`}
        style={[
          styles.card,
          prominent ? styles.cardProminent : styles.cardQuiet,
        ]}
      >
        <View style={styles.cardText}>
          <Text style={styles.strong} numberOfLines={2}>
            {recent.title}
          </Text>
        </View>
        <Chevron style={styles.chev} />
      </Pressable>
    </View>
  )
}

/** Shown when the club has switched off everything else Home could show. */
export function HomeFallback({ onPress }: { onPress: () => void }) {
  const styles = useThemedStyles(makeStyles)
  const vocabulary = useVocabulary()
  return (
    <View style={styles.fallback}>
      <Text style={styles.fallbackText}>
        Здесь появятся ваши {vocabulary.session.nomPl}, абонемент и новости клуба.
      </Text>
      <Pressable onPress={onPress} accessibilityRole="button" style={styles.fallbackButton}>
        <Text style={styles.fallbackButtonText}>Смотреть видео</Text>
      </Pressable>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    card: {
      flexGrow: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      paddingHorizontal: theme.spacing(4),
    },
    // The role's main block: raised, roomier.
    cardProminent: {
      backgroundColor: theme.colors.surfaceElevated,
      paddingVertical: theme.spacing(4),
      ...theme.shadows.sm,
    },
    // Everything else: flat and tighter, so the main block reads first.
    cardQuiet: {
      backgroundColor: theme.colors.surface,
      paddingVertical: theme.spacing(3),
    },
    cardNoGrow: { flexGrow: 0 },
    cardText: { flex: 1, gap: 2 },
    cardTitle: { ...theme.typography.captionStrong, color: theme.colors.muted },
    cardHeading: {
      ...theme.typography.subheading,
      color: theme.colors.text,
      marginBottom: theme.spacing(1),
    },
    strong: { ...theme.typography.bodyStrong, color: theme.colors.text },
    strongLarge: { ...theme.typography.heading, color: theme.colors.text },
    line: { ...theme.typography.body, color: theme.colors.text },
    muted: { ...theme.typography.caption, color: theme.colors.muted },
    bar: {
      height: 6,
      borderRadius: 3,
      marginTop: theme.spacing(1),
      backgroundColor: theme.colors.surfaceMuted,
      overflow: "hidden",
    },
    barFill: { height: "100%", borderRadius: 3 },
    abonementRow: { gap: 2, paddingTop: theme.spacing(1) },
    classRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      paddingVertical: theme.spacing(2),
    },
    classBody: { flex: 1, gap: 2 },
    classLine: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: theme.spacing(2),
    },
    classTime: { ...theme.typography.bodyStrong, color: theme.colors.text },
    classTimeLive: { color: theme.colors.accent },
    classTitle: {
      ...theme.typography.body,
      color: theme.colors.text,
      flexShrink: 1,
    },
    classSub: { ...theme.typography.caption, color: theme.colors.muted },
    nextLine: { flex: 1 },
    markButton: {
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(1) + 2,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accent,
    },
    markButtonText: {
      color: theme.colors.accentText,
      fontSize: 13,
      fontWeight: "600",
    },
    finishedToggle: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(1),
      paddingVertical: theme.spacing(1),
    },
    footerLink: { alignSelf: "flex-start", paddingVertical: theme.spacing(1) },
    chev: { fontSize: 20, color: theme.colors.mutedFaint, lineHeight: 20 },
    banner: {
      padding: theme.spacing(4),
      borderRadius: theme.radius.lg,
      gap: theme.spacing(1),
    },
    bannerDanger: { backgroundColor: theme.colors.dangerSoft },
    bannerWarn: { backgroundColor: theme.colors.warningSoft },
    bannerTitle: { fontSize: 15, fontWeight: "700", color: theme.colors.text },
    bannerText: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      lineHeight: 19,
    },
    continueWrap: { flexGrow: 1, gap: theme.spacing(2) },
    continueHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: theme.spacing(1),
    },
    link: { fontSize: 13, fontWeight: "700", color: theme.colors.accent },
    fallback: {
      alignItems: "center",
      gap: theme.spacing(3),
      padding: theme.spacing(6),
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderStyle: "dashed",
    },
    fallbackText: {
      ...theme.typography.body,
      color: theme.colors.muted,
      textAlign: "center",
    },
    fallbackButton: {
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    fallbackButtonText: {
      color: theme.colors.text,
      fontSize: 14,
      fontWeight: "500",
    },
  })
