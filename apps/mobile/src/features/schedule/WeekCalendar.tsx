import React, { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from "react-native"

import { Pressable } from "../../shared/components/Pressable"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  WEEK_DAYS,
  blockDetail,
  blockFrame,
  dayOfMonth,
  fitLines,
  nowOffset,
  tintColor,
  weekdayShort,
  type BlockDetail,
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
const WIDE: Sizes = { axis: 56, hour: 72, header: 44, line: 14 }
const COMPACT: Sizes = { axis: 36, hour: 44, header: 44, line: 12 }
// Room above the first hour line and below the last, so their labels —
// centred on the lines — aren't clipped.
const EDGE = 10
// Half the hour label's line height: the label's middle sits on its line.
const LABEL_HALF = 7
// How long a programmatic page scroll may take before user scrolls count again.
const SCROLL_SETTLE_MS = 900

const hhmm = (h: number) => `${String(h).padStart(2, "0")}:00`

/**
 * The schedule as a week grid: day headers pinned on top, a time axis on the
 * left and, to its right, week pages of seven day columns that scroll (and
 * snap) sideways — forward in time. Hour lines run under every column with a
 * fainter half-hour line; each hour label sits centred on its line. Blocks
 * sit by start/end on the axis; overlapping ones share the column side by
 * side. `page` is controlled: arrows set it, a swipe reports it through
 * `onPageChange`. With `viewportHeight` the hours scroll inside it under the
 * pinned headers.
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
  viewportHeight,
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
  viewportHeight?: number
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
  const gridHeight = EDGE + bodyHeight + EDGE

  const scrollRef = useRef<ScrollViewInstance>(null)
  const headerRef = useRef<ScrollViewInstance>(null)
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
    headerRef.current?.scrollTo({ x: p * pageWidth, y: 0, animated })
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
    const x = e.nativeEvent.contentOffset.x
    // The pinned day headers follow the swipe.
    headerRef.current?.scrollTo({ x, y: 0, animated: false })
    const p = Math.min(pages - 1, Math.max(0, Math.round(x / pageWidth)))
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
  const showNow = page === 0 && nowTop !== null
  // Lines at every hour from the first to the last, the last closing the grid.
  const hourMarks = Array.from({ length: hours + 1 }, (_, i) => axis.startHour + i)
  // An hour label the «сейчас» label would sit on top of gives way to it.
  const coveredByNow = (i: number) =>
    showNow && Math.abs(i * size.hour - nowTop) < LABEL_HALF * 2
  const pageKeys = (p: number) =>
    dayKeys.slice(p * WEEK_DAYS, p * WEEK_DAYS + WEEK_DAYS)

  const grid = (
    <View style={styles.row}>
      <View style={{ width: size.axis, height: gridHeight }}>
        {hourMarks.map((h, i) =>
          coveredByNow(i) ? null : (
            <Text
              key={h}
              style={[
                styles.hourLabel,
                compact && styles.hourLabelCompact,
                { top: EDGE + i * size.hour - LABEL_HALF },
              ]}
            >
              {hhmm(h)}
            </Text>
          ),
        )}
        {showNow && (
          <Text
            style={[
              styles.nowLabel,
              // The browser has no adjustsFontSizeToFit: without this the
              // phone's narrow axis cut the word to «сей…».
              compact && styles.nowLabelCompact,
              { top: EDGE + nowTop - LABEL_HALF },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
            accessibilityLabel="Сейчас"
          >
            сейчас
          </Text>
        )}
      </View>

      {pageWidth > 0 && (
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={{ width: pageWidth }}
        >
          {Array.from({ length: pages }, (_, p) => (
            <View key={p} style={{ width: pageWidth, height: gridHeight }}>
              {hourMarks.map((h, i) => (
                <View
                  key={h}
                  style={[styles.hourLine, { top: EDGE + i * size.hour }]}
                />
              ))}
              {hourMarks.slice(0, -1).map((h, i) => (
                <View
                  key={`${h}:30`}
                  style={[
                    styles.halfHourLine,
                    { top: EDGE + i * size.hour + size.hour / 2 },
                  ]}
                />
              ))}
              <View style={styles.columns}>
                {pageKeys(p).map((key) => (
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
                              top: EDGE + frame.top,
                              height: frame.height,
                              left: `${(seg.column / seg.columns) * 100}%`,
                              width: `${(seg.span / seg.columns) * 100}%`,
                            },
                          ]}
                        >
                          <CalendarBlock
                            content={describe(seg)}
                            height={frame.height - 2}
                            detail={blockDetail(blockWidth)}
                            compact={compact}
                            lineHeight={size.line}
                          />
                        </View>
                      )
                    })}
                    {key === todayKey && nowTop !== null && (
                      <View
                        pointerEvents="none"
                        style={[styles.nowLine, { top: EDGE + nowTop - 1 }]}
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
          ))}
        </ScrollView>
      )}
    </View>
  )

  return (
    <View
      style={styles.root}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
    >
      <View style={[styles.row, styles.headerBar]}>
        <View style={{ width: size.axis, height: size.header }} />
        {pageWidth > 0 && (
          <ScrollView
            ref={headerRef}
            horizontal
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            style={{ width: pageWidth }}
          >
            {Array.from({ length: pages }, (_, p) => (
              <View
                key={p}
                style={[styles.headerRow, { width: pageWidth, height: size.header }]}
              >
                {pageKeys(p).map((key) => (
                  <DayHeader
                    key={key}
                    dateKey={key}
                    today={key === todayKey}
                    compact={compact}
                    onPress={onDayPress ? () => onDayPress(key) : undefined}
                  />
                ))}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
      {viewportHeight && gridHeight > viewportHeight ? (
        <ScrollView
          style={{ height: viewportHeight }}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          {grid}
        </ScrollView>
      ) : (
        grid
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
    <View style={compact ? styles.headerStack : styles.headerLine}>
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
    </View>
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
  detail,
  compact,
  lineHeight,
}: {
  content: CalendarBlockContent
  height: number
  detail: BlockDetail
  compact: boolean
  lineHeight: number
}) {
  const narrow = detail === "narrow" || detail === "time" || detail === "bare"
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
  const time = detail !== "full" || compact ? c.start : `${c.start}–${c.end}`
  const maxLines = Math.max(1, Math.floor((height - 4) / lineHeight))
  const lines =
    detail === "bare"
      ? []
      : detail === "time"
        ? [{ key: "time", priority: 0 }]
        : fitLines(
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
  // The title takes whatever lines the others leave; a narrow block keeps it
  // to one line, since a few letters per line would break words apart.
  const titleLines = narrow ? 1 : Math.max(1, maxLines - (lines.length - 1))

  const inner = lines.map((l) => {
    switch (l.key) {
      case "time":
        return (
          <Text
            key="time"
            numberOfLines={1}
            style={[
              styles.blockTime,
              (compact || narrow) && styles.blockTextCompact,
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
    detail === "bare" && styles.blockBare,
    {
      backgroundColor: fill,
      borderColor:
        c.kind === "event"
          ? edge
          : (tintColor(c.color, 0.45) ??
            (c.kind === "personal" ? theme.colors.success : theme.colors.borderStrong)),
      borderLeftColor: edge,
    },
    c.kind === "event" && styles.blockEvent,
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
    root: { width: "100%" },
    row: { flexDirection: "row" },
    headerBar: {
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
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
    nowLabelCompact: { fontSize: 8 },
    headerRow: { flexDirection: "row" },
    headerCell: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    headerLine: { flexDirection: "row", alignItems: "center", gap: 6 },
    headerStack: { alignItems: "center", gap: 2 },
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
    headerDay: { fontSize: 15, fontWeight: "700", color: theme.colors.text },
    headerDayCompact: { fontSize: 13 },
    headerDayTodayText: { color: theme.colors.accentText },
    hourLine: {
      position: "absolute",
      left: 0,
      right: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.border,
    },
    halfHourLine: {
      position: "absolute",
      left: 0,
      right: 0,
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.colors.border,
      opacity: 0.4,
    },
    columns: { ...StyleSheet.absoluteFill, flexDirection: "row" },
    column: {
      flex: 1,
      position: "relative",
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: theme.colors.border,
    },
    slot: { position: "absolute", paddingHorizontal: 2, paddingVertical: 1 },
    block: {
      flex: 1,
      overflow: "hidden",
      borderRadius: 6,
      borderWidth: 1,
      borderLeftWidth: 3,
      paddingHorizontal: 6,
      paddingVertical: 3,
    },
    blockEvent: { borderStyle: "dashed" },
    blockDim: { opacity: 0.55 },
    blockNarrow: { paddingHorizontal: 2, paddingVertical: 2, borderLeftWidth: 2 },
    blockBare: { paddingHorizontal: 0, paddingVertical: 0 },
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
