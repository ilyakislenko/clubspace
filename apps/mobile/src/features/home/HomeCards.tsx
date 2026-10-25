import React, { type ReactNode } from "react"
import { StyleSheet, Text, View } from "react-native"

import type { Announcement } from "../../shared/api/announcements"
import type { DropInBooking } from "../../shared/api/drop-ins"
import type { MyGroup } from "../../shared/api/groups"
import type { PendingFreezeRequest } from "../../shared/api/member-subscriptions"
import type { PersonalTraining } from "../../shared/api/personal-trainings"
import type { MySubscription } from "../../shared/api/subscriptions"
import { Chevron } from "../../shared/components/Chevron"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { formatRuDayRange, pluralRu } from "../../shared/format-ru"
import { useResponsive } from "../../shared/useResponsive"
import {
  findNextAcrossGroups,
  formatDuration,
  formatNextSessionLabel,
  formatUpcomingLabel,
} from "../schedule/schedule-helpers"
import type { RecentEntry } from "../profile/preferences-store"
import { pickNextTraining, type CoachClassToday } from "./home-helpers"
import {
  fmtDate,
  freezeLine,
  freezePhase,
  subscriptionState,
  toneColor,
  type AccessVariant,
} from "../subscription/subscription-state"

// A tappable (or plain) summary card. `onPress` adds the chevron. It grows to
// its grid cell's height so a row of cards lines up; `grow={false}` where
// there is no row to match (a column next to taller content would otherwise
// stretch it to that height — Yoga's legacy flexGrow behaviour).
export function HomeCard({
  title,
  onPress,
  children,
  accessibilityLabel,
  grow = true,
}: {
  title: string
  onPress?: () => void
  children: ReactNode
  accessibilityLabel?: string
  grow?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  const style = grow ? styles.card : [styles.card, styles.cardNoGrow]
  const body = (
    <>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>{title}</Text>
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

/** The soonest class: across the member's groups, a guest booking or a personal session. */
export function NextClassCard({
  groups,
  bookings,
  personal,
  onPress,
}: {
  groups: MyGroup[]
  bookings: DropInBooking[]
  // Confirmed sessions where the viewer is the student.
  personal: PersonalTraining[]
  onPress: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  const { sizeClass } = useResponsive()
  const now = new Date()
  const found = pickNextTraining(
    findNextAcrossGroups(groups, now),
    bookings,
    now,
    personal,
  )

  if (!found) {
    if (groups.length === 0) {
      return (
        <HomeCard title="Ближайшая тренировка">
          <Text style={styles.muted}>
            Вас пока не добавили в группу — это делает тренер или администратор
            клуба.
          </Text>
        </HomeCard>
      )
    }
    return (
      <HomeCard title="Ближайшая тренировка" onPress={onPress}>
        <Text style={styles.muted}>В ближайшие две недели тренировок нет.</Text>
      </HomeCard>
    )
  }
  if (found.kind === "personal") {
    const { training } = found
    const label = formatUpcomingLabel(found.startAt, training.timezone, now)
    return (
      <HomeCard
        title="Ближайшая тренировка"
        onPress={onPress}
        accessibilityLabel={`Ближайшая тренировка: ${label}, персональная тренировка`}
      >
        <Text
          style={sizeClass === "expanded" ? styles.strongLarge : styles.strong}
        >
          {label}
        </Text>
        <Text style={styles.line}>Персональная тренировка</Text>
        <Text style={styles.muted}>
          Тренер: {training.coach.displayName}
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
        title="Ближайшая тренировка"
        onPress={onPress}
        accessibilityLabel={`Ближайшая тренировка: ${label}, ${booking.groupName}, гостевой визит`}
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
  const { next, group } = found
  return (
    <HomeCard
      title="Ближайшая тренировка"
      onPress={onPress}
      accessibilityLabel={`Ближайшая тренировка: ${formatNextSessionLabel(next)}, ${group.name}`}
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

/** A coach's personal-training requests waiting for an answer. */
export function PersonalRequestsCard({
  count,
  onPress,
}: {
  count: number
  onPress: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <HomeCard title="Заявки на персональные" onPress={onPress}>
      <Text style={styles.strong}>
        {count}{" "}
        {pluralRu(count, "заявка ждёт", "заявки ждут", "заявок ждут")} вашего
        ответа
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
    <HomeCard title="Заявки на заморозку">
      <Text style={styles.strong}>
        {count} {pluralRu(count, "заявка ждёт", "заявки ждут", "заявок ждут")}{" "}
        вашего ответа
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

/** «Сегодня вы ведёте»: the coach's own classes today, each with a mark button. */
export function CoachTodayCard({
  classes,
  onMark,
  grow,
}: {
  classes: CoachClassToday[]
  onMark: (c: CoachClassToday) => void
  grow?: boolean
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <HomeCard title="Сегодня вы ведёте" grow={grow}>
      {classes.length === 0 ? (
        <Text style={styles.muted}>Сегодня занятий по расписанию нет</Text>
      ) : (
        classes.map((c) => (
          <View key={c.key} style={styles.classRow}>
            <Text style={styles.classText} numberOfLines={2}>
              {[c.startTime, c.groupName, c.gymName].filter(Boolean).join(" · ")}
            </Text>
            <Pressable
              onPress={() => onMark(c)}
              accessibilityRole="button"
              accessibilityLabel={`Отметить: ${c.startTime}, ${c.groupName}`}
              style={styles.markButton}
            >
              <Text style={styles.markButtonText}>Отметить</Text>
            </Pressable>
          </View>
        ))
      )}
    </HomeCard>
  )
}

/** Plan, state line and visits left. */
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
  const state = subscriptionState(data)
  const current = data.current
  // Per render: Home is a tab and stays mounted. A current freeze is already
  // the state line; only an upcoming one needs its own line.
  const upcomingFreeze =
    data.freeze && freezePhase(data.freeze) === "upcoming"
      ? freezeLine(data.freeze)
      : null
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

/** The newest (pinned first) announcement. */
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
      title={item.pinned ? "Объявление · закреплено" : "Объявление"}
      onPress={onPress}
      grow={grow}
    >
      <Text style={styles.strong} numberOfLines={1}>
        {item.title}
      </Text>
      <Text style={styles.muted} numberOfLines={2}>
        {item.body}
      </Text>
    </HomeCard>
  )
}

/** Resume the last video; «Все» when there's more than one to continue. */
export function ContinueRow({
  recent,
  count,
  onOpen,
  onAll,
}: {
  recent: RecentEntry
  count: number
  onOpen: () => void
  onAll: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.continueWrap}>
      <View style={styles.continueHeader}>
        <Text style={styles.cardTitle}>Продолжить просмотр</Text>
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
        style={styles.card}
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
  return (
    <View style={styles.fallback}>
      <Text style={styles.fallbackText}>
        Здесь появятся ваши тренировки, абонемент и новости клуба.
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
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing(4),
      ...theme.shadows.sm,
    },
    cardNoGrow: { flexGrow: 0 },
    cardText: { flex: 1, gap: 2 },
    cardTitle: { ...theme.typography.label },
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
    classRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      paddingVertical: theme.spacing(1),
    },
    classText: { ...theme.typography.body, color: theme.colors.text, flex: 1 },
    markButton: {
      paddingHorizontal: theme.spacing(4),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.accent,
    },
    markButtonText: {
      color: theme.colors.accentText,
      fontSize: 14,
      fontWeight: "600",
    },
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
