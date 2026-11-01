import React, { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native"

import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  WEEK_DAYS,
  blockFrame,
  dayOfMonth,
  fitLines,
  nowOffset,
  tintColor,
  weekdayShort,
  type BlockTone,
  type PlacedSegment,
  type TimeAxis,
} from "./schedule-calendar"

/** What one block says; the screen builds it from the class, event or session. */
export type CalendarBlockContent = {
  kind: "session" | "event" | "personal"
  start: string
  end: string
  title: string
  gym: string | null
  person: string | null
  state: { text: string; tone: BlockTone } | null
  // The direction's club-set color; null = the theme accent.
  color: string | null
  past: boolean
  cancelled: boolean
  accessibilityLabel: string
  onPress?: () => void
}

type Sizes = { axis: number; hour: number; header: number; line: number }
const WIDE: Sizes = { axis: 52, hour: 72, header: 52, line: 14 }
const COMPACT: Sizes = { axis: 36, hour: 44, header: 44, line: 12 }
// A block narrower than this shows only its start time.
const NARROW_BLOCK = 72
// How long a programmatic page scroll may take before user scrolls count again.
const SCROLL_SETTLE_MS = 900

/**
 * The schedule as a week grid: a time axis on the left and, to its right,
 * week pages of seven day columns that scroll (and snap) sideways — forward
 * in time. Blocks sit by start/end on the axis; overlapping ones share the
 * column side by side. `page` is controlled: arrows set it, a swipe reports
 * it through `onPageChange`.
 */
export function WeekCalendar({
  dayKeys,
  page,
  onPageChange,
  days,
  loading,
  axis,
  todayKey,
  nowMinute,
  compact,
  describe,
  onDayPress,
}: {
  // Every day the calendar can show, from today; a page is seven of them.
  dayKeys: readonly string[]
  page: number
  onPageChange: (page: number) => void
  // The placed segments of the loaded days.
  days: ReadonlyMap<string, PlacedSegment[]>
  loading: boolean
  axis: TimeAxis
  todayKey: string
  nowMinute: number
  compact: boolean
  describe: (seg: PlacedSegment) => CalendarBlockContent
  onDayPress?: (dateKey: string) => void
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const size = compact ? COMPACT : WIDE
  const [width, setWidth] = useState(0)
  const pageWidth = Math.max(0, width - size.axis)
  const pages = Math.ceil(dayKeys.length / WEEK_DAYS)
  const hours = axis.endHour - axis.startHour
  const bodyHeight = hours * size.hour

  const scrollRef = useRef<ScrollView>(null)
  // The page on screen, and the one a programmatic scroll is heading to.
  const shown = useRef(page)
  const target = useRef<number | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const scrollToPage = (p: number, animated: boolean) => {
    if (!pageWidth) return
    target.current = animated ? p : null
    clearTimeout(settle.current)
    if (animated) {
      settle.current = setTimeout(() => {
        target.current = null
      }, SCROLL_SETTLE_MS)
    }
    scrollRef.current?.scrollTo({ x: p * pageWidth, y: 0, animated })
  }

  // Arrows / «Сегодня» / a day picked elsewhere move the pages.
  useEffect(() => {
    if (shown.current === page) return
    shown.current = page
    scrollToPage(page, true)
  }, [page])

  // A new width (first layout, rotation, window resize) keeps the page.
  useEffect(() => {
    scrollToPage(shown.current, false)
  }, [pageWidth])

  useEffect(
    () => () => {
      clearTimeout(settle.current)
    },
    [],
  )

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!pageWidth) return
    const p = Math.min(
      pages - 1,
      Math.max(0, Math.round(e.nativeEvent.contentOffset.x / pageWidth)),
    )
    if (target.current !== null) {
      if (p === target.current) target.current = null
      return
    }
    if (p !== shown.current) {
      shown.current = p
      onPageChange(p)
    }
  }

  const nowTop = nowOffset(nowMinute, axis, size.hour)
  const hourMarks = Array.from({ length: hours }, (_, i) => axis.startHour + i)

  return (
    <View
      style={styles.root}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
      <View style={{ width: size.axis }}>
        <View style={{ height: size.header }} />
        <View style={{ height: bodyHeight }}>
          {hourMarks.map((h, i) => (
            <Text
              key={h}
              style={[
                styles.hourLabel,
                compact && styles.hourLabelCompact,
                { top: i * size.hour + 2 },
              ]}
            >
              {`${String(h).padStart(2, "0")}:00`}
            </Text>
          ))}
          {page === 0 && nowTop !== null && (
            <Text
              style={[styles.nowLabel, { top: Math.max(0, nowTop - 7) }]}
              accessibilityLabel="Сейчас"
            >
              сейчас
            </Text>
          )}
        </View>
      </View>

      {pageWidth > 0 && (
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={32}
          style={{ width: pageWidth }}
        >
          {Array.from({ length: pages }, (_, p) => (
            <View key={p} style={{ width: pageWidth }}>
              <View style={[styles.headerRow, { height: size.header }]}>
                {dayKeys
                  .slice(p * WEEK_DAYS, p * WEEK_DAYS + WEEK_DAYS)
                  .map((key) => (
                    <DayHeader
                      key={key}
                      dateKey={key}
                      today={key === todayKey}
                      compact={compact}
                      onPress={onDayPress ? () => onDayPress(key) : undefined}
                    />
                  ))}
              </View>
              <View style={[styles.body, { height: bodyHeight }]}>
                {hourMarks.map((h, i) => (
                  <View
                    key={h}
                    style={[styles.hourLine, { top: i * size.hour }]}
                  />
                ))}
                <View style={styles.columns}>
                  {dayKeys
                    .slice(p * WEEK_DAYS, p * WEEK_DAYS + WEEK_DAYS)
                    .map((key) => (
                      <View key={key} style={styles.column}>
                        {(days.get(key) ?? []).map((seg) => {
                          const frame = blockFrame(seg, axis, size.hour)
                          const blockWidth =
                            ((pageWidth / WEEK_DAYS) * seg.span) / seg.columns
                          return (
                            <View
                              key={`${seg.item.key}:${key}`}
                              style={[
                                styles.slot,
                                {
                                  top: frame.top,
                                  height: frame.height,
                                  left: `${(seg.column / seg.columns) * 100}%`,
                                  width: `${(seg.span / seg.columns) * 100}%`,
                                },
                              ]}
                            >
                              <CalendarBlock
                                content={describe(seg)}
                                height={frame.height}
                                narrow={blockWidth < NARROW_BLOCK}
                                compact={compact}
                                lineHeight={size.line}
                              />
                            </View>
                          )
                        })}
                        {key === todayKey && nowTop !== null && (
                          <View
                            pointerEvents="none"
                            style={[styles.nowLine, { top: nowTop }]}
                          >
                            <View style={styles.nowDot} />
                          </View>
                        )}
                      </View>
                    ))}
                </View>
                {loading && (
                  <View style={styles.loading} pointerEvents="none">
                    <ActivityIndicator color={theme.colors.accent} />
                  </View>
                )}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

function DayHeader({
  dateKey,
  today,
  compact,
  onPress,
}: {
  dateKey: string
  today: boolean
  compact: boolean
  onPress?: () => void
}) {
  const styles = useThemedStyles(makeStyles)
  const inner = (
    <>
      <Text style={[styles.headerWeekday, today && styles.headerToday]}>
        {weekdayShort(dateKey)}
      </Text>
      <View style={[styles.headerDayWrap, today && styles.headerDayToday]}>
        <Text
          style={[
            styles.headerDay,
            compact && styles.headerDayCompact,
            today && styles.headerDayTodayText,
          ]}
        >
          {dayOfMonth(dateKey)}
        </Text>
      </View>
    </>
  )
  const label = `${today ? "Сегодня, " : ""}${weekdayShort(dateKey)} ${dayOfMonth(dateKey)}`
  return onPress ? (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} — открыть день`}
      style={styles.headerCell}
    >
      {inner}
    </Pressable>
  ) : (
    <View style={styles.headerCell} accessibilityLabel={label}>
      {inner}
    </View>
  )
}

/** One class / event / personal session on the grid. */
export function CalendarBlock({
  content: c,
  height,
  narrow,
  compact,
  lineHeight,
}: {
  content: CalendarBlockContent
  height: number
  narrow: boolean
  compact: boolean
  lineHeight: number
}) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const edge =
    c.kind === "personal"
      ? theme.colors.success
      : (c.color ?? theme.colors.accent)
  const fill =
    c.kind === "event"
      ? theme.colors.surface
      : c.kind === "personal"
        ? theme.colors.successSoft
        : (tintColor(c.color, 0.2) ?? theme.colors.accentSoft)
  const toneStyle =
    c.state?.tone === "mine"
      ? styles.stateMine
      : c.state?.tone === "full"
        ? styles.stateFull
        : c.state?.tone === "cancelled"
          ? styles.stateCancelled
          : null
  const time = narrow || compact ? c.start : `${c.start}–${c.end}`
  const maxLines = Math.max(1, Math.floor((height - 4) / lineHeight))
  const lines = fitLines(
    [
      { key: "time", priority: 0 },
      { key: "title", priority: 0 },
      ...(c.state && !compact ? [{ key: "state", priority: 1 }] : []),
      ...(c.gym && !compact && !narrow ? [{ key: "gym", priority: 2 }] : []),
      ...(c.person && !compact && !narrow
        ? [{ key: "person", priority: 3 }]
        : []),
    ],
    maxLines,
  )
  // The title takes whatever lines the others leave.
  const titleLines = Math.max(1, maxLines - (lines.length - 1))

  const inner = lines.map((l) => {
    switch (l.key) {
      case "time":
        return (
          <Text
            key="time"
            numberOfLines={1}
            style={[
              styles.blockTime,
              compact && styles.blockTextCompact,
              c.cancelled && styles.strike,
            ]}
          >
            {c.kind === "event" && !compact && !narrow ? `Событие · ${time}` : time}
          </Text>
        )
      case "title":
        return (
          <Text
            key="title"
            numberOfLines={titleLines}
            style={[
              styles.blockTitle,
              (compact || narrow) && styles.blockTextCompact,
              c.cancelled && styles.strike,
            ]}
          >
            {c.title}
          </Text>
        )
      case "state":
        return (
          <Text key="state" numberOfLines={1} style={[styles.blockState, toneStyle]}>
            {c.state!.text}
          </Text>
        )
      case "gym":
        return (
          <Text key="gym" numberOfLines={1} style={styles.blockMeta}>
            {c.gym}
          </Text>
        )
      default:
        return (
          <Text key="person" numberOfLines={1} style={styles.blockMeta}>
            {c.person}
          </Text>
        )
    }
  })

  const style = [
    styles.block,
    (narrow || compact) && styles.blockNarrow,
    { backgroundColor: fill, borderLeftColor: edge },
    c.kind === "event" && [styles.blockEvent, { borderColor: edge }],
    (c.past || c.cancelled) && styles.blockDim,
  ]
  return c.onPress ? (
    <Pressable
      onPress={c.onPress}
      accessibilityRole="button"
      accessibilityLabel={c.accessibilityLabel}
      style={style}
    >
      {inner}
    </Pressable>
  ) : (
    <View style={style} accessibilityLabel={c.accessibilityLabel}>
      {inner}
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flexDirection: "row", width: "100%" },
    hourLabel: {
      position: "absolute",
      left: 0,
      right: theme.spacing(1),
      textAlign: "right",
      fontSize: 11,
      color: theme.colors.muted,
      fontVariant: ["tabular-nums"],
    },
    hourLabelCompact: { fontSize: 9 },
    nowLabel: {
      position: "absolute",
      left: 0,
      right: 2,
      textAlign: "right",
      fontSize: 10,
      fontWeight: "700",
      color: theme.colors.danger,
      backgroundColor: theme.colors.background,
    },
    headerRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    headerCell: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
    },
    headerWeekday: {
      fontSize: 11,
      fontWeight: "600",
      color: theme.colors.muted,
      textTransform: "uppercase",
    },
    headerToday: { color: theme.colors.accent },
    headerDayWrap: {
      minWidth: 26,
      height: 26,
      paddingHorizontal: 4,
      borderRadius: theme.radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    headerDayToday: { backgroundColor: theme.colors.accent },
    headerDay: { fontSize: 16, fontWeight: "700", color: theme.colors.text },
    headerDayCompact: { fontSize: 13 },
    headerDayTodayText: { color: theme.colors.accentText },
    body: { position: "relative" },
    hourLine: {
      position: "absolute",
      left: 0,
      right: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.border,
    },
    columns: { flex: 1, flexDirection: "row" },
    column: {
      flex: 1,
      position: "relative",
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: theme.colors.border,
    },
    slot: { position: "absolute", padding: 1 },
    block: {
      flex: 1,
      overflow: "hidden",
      borderRadius: theme.radius.xs,
      borderLeftWidth: 3,
      paddingHorizontal: 4,
      paddingVertical: 2,
    },
    blockEvent: { borderWidth: 1, borderStyle: "dashed", borderLeftWidth: 3 },
    blockDim: { opacity: 0.55 },
    blockNarrow: { paddingHorizontal: 2, borderLeftWidth: 2 },
    blockTime: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      color: theme.colors.text,
      fontVariant: ["tabular-nums"],
    },
    blockTitle: {
      fontSize: 12,
      lineHeight: 14,
      fontWeight: "600",
      color: theme.colors.text,
    },
    blockTextCompact: { fontSize: 9, lineHeight: 12 },
    blockState: {
      fontSize: 11,
      lineHeight: 14,
      fontWeight: "700",
      color: theme.colors.textSecondary,
    },
    stateMine: { color: theme.colors.success },
    stateFull: { color: theme.colors.danger },
    stateCancelled: { color: theme.colors.danger },
    blockMeta: { fontSize: 11, lineHeight: 14, color: theme.colors.muted },
    strike: { textDecorationLine: "line-through" },
    nowLine: {
      position: "absolute",
      left: 0,
      right: 0,
      height: 2,
      backgroundColor: theme.colors.danger,
    },
    nowDot: {
      position: "absolute",
      left: -4,
      top: -3,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.colors.danger,
    },
    loading: {
      position: "absolute",
      top: theme.spacing(6),
      left: 0,
      right: 0,
      alignItems: "center",
    },
  })
