import React, { type ReactNode } from "react"
import { StyleSheet, Text, View } from "react-native"

import type { Announcement } from "../../shared/api/announcements"
import type { MyGroup } from "../../shared/api/groups"
import type { MySubscription } from "../../shared/api/subscriptions"
import { Chevron } from "../../shared/components/Chevron"
import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  findNextAcrossGroups,
  formatDuration,
  formatNextSessionLabel,
} from "../schedule/schedule-helpers"
import type { RecentEntry } from "../profile/preferences-store"
import {
  fmtDate,
  subscriptionState,
  toneColor,
  type AccessVariant,
} from "../subscription/subscription-state"

// A tappable (or plain) summary card. `onPress` adds the chevron.
function HomeCard({
  title,
  onPress,
  children,
  accessibilityLabel,
}: {
  title: string
  onPress?: () => void
  children: ReactNode
  accessibilityLabel?: string
}) {
  const styles = useThemedStyles(makeStyles)
  const body = (
    <>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>{title}</Text>
        {children}
      </View>
      {onPress && <Chevron style={styles.chev} />}
    </>
  )
  if (!onPress) return <View style={styles.card}>{body}</View>
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={styles.card}
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

/** The soonest class across the member's groups. */
export function NextClassCard({
  groups,
  onPress,
}: {
  groups: MyGroup[]
  onPress: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  const found = findNextAcrossGroups(groups)

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
  if (!found) {
    return (
      <HomeCard title="Ближайшая тренировка" onPress={onPress}>
        <Text style={styles.muted}>В ближайшие две недели тренировок нет.</Text>
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
      <Text style={styles.strong}>{formatNextSessionLabel(next)}</Text>
      <Text style={styles.line}>{group.name}</Text>
      <Text style={styles.muted}>
        {[group.gym?.name, formatDuration(next.slot.durationMin)]
          .filter(Boolean)
          .join(" · ")}
      </Text>
    </HomeCard>
  )
}

/** Plan, state line and visits left. */
export function SubscriptionCard({
  data,
  onPress,
}: {
  data: MySubscription
  onPress: () => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const state = subscriptionState(data)
  const current = data.current
  return (
    <HomeCard title="Абонемент" onPress={onPress}>
      {current && <Text style={styles.strong}>{current.planName}</Text>}
      <Text style={[styles.line, { color: toneColor(theme.colors, state.tone) }]}>
        {state.text}
      </Text>
      {current?.classesRemaining != null && (
        <Text style={styles.muted}>
          Осталось занятий: {current.classesRemaining}
          {current.classesTotal != null ? ` из ${current.classesTotal}` : ""}
        </Text>
      )}
    </HomeCard>
  )
}

/** The newest (pinned first) announcement. */
export function AnnouncementCard({
  item,
  onPress,
}: {
  item: Announcement
  onPress: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  return (
    <HomeCard title={item.pinned ? "Анонс · закреплено" : "Анонс"} onPress={onPress}>
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
    cardText: { flex: 1, gap: 2 },
    cardTitle: { ...theme.typography.label },
    strong: { ...theme.typography.bodyStrong, color: theme.colors.text },
    line: { ...theme.typography.body, color: theme.colors.text },
    muted: { ...theme.typography.caption, color: theme.colors.muted },
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
    continueWrap: { gap: theme.spacing(2) },
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
