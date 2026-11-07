import React, { useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import { errorMessage } from "../../shared/error-message"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { formatBookmarkTime } from "../video/format-position"
import {
  COMPARE_SOURCES,
  type CompareClip,
  type CompareGroup,
  type CompareSourceContext,
} from "./compare-sources"

const SEARCH_DEBOUNCE_MS = 350

type Props = {
  title: string
  context: Omit<CompareSourceContext, "query">
  onSelect: (clip: CompareClip) => void
  onClose: () => void
}

type Loaded<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string }

// «С чем сравнить»: one tab per compare source, a search box, and the
// source's groups (a lesson, a plan) with their moments and segments.
export function ComparePicker({ title, context, onSelect, onClose }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [sourceIndex, setSourceIndex] = useState(0)
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [groups, setGroups] = useState<Loaded<CompareGroup[]>>({ status: "loading" })
  // Clips of opened lazily-loaded groups, by group key.
  const [opened, setOpened] = useState<Record<string, Loaded<CompareClip[]>>>({})
  const loadSeq = useRef(0)
  const source = COMPARE_SOURCES[sourceIndex]
  const { workspaceId, online, currentVideo } = context

  useEffect(() => {
    const id = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])

  useEffect(() => {
    const seq = ++loadSeq.current
    setGroups({ status: "loading" })
    setOpened({})
    source
      .load({ workspaceId, online, currentVideo, query: search })
      .then((data) => {
        if (seq === loadSeq.current) setGroups({ status: "ready", data })
      })
      .catch((err: unknown) => {
        if (seq === loadSeq.current) {
          setGroups({ status: "error", message: errorMessage(err, "Не удалось загрузить список.") })
        }
      })
  }, [source, search, workspaceId, online, currentVideo])

  const toggleGroup = (group: CompareGroup) => {
    const load = group.loadClips
    if (!load) return
    if (opened[group.key]) {
      setOpened((o) => {
        const next = { ...o }
        delete next[group.key]
        return next
      })
      return
    }
    setOpened((o) => ({ ...o, [group.key]: { status: "loading" } }))
    load()
      .then((data) =>
        setOpened((o) =>
          o[group.key] ? { ...o, [group.key]: { status: "ready", data } } : o,
        ),
      )
      .catch((err: unknown) =>
        setOpened((o) =>
          o[group.key]
            ? {
                ...o,
                [group.key]: {
                  status: "error",
                  message: errorMessage(err, "Не удалось загрузить."),
                },
              }
            : o,
        ),
      )
  }

  const renderClips = (clips: readonly CompareClip[]) =>
    clips.length === 0 ? (
      <Text style={styles.muted}>Пусто</Text>
    ) : (
      clips.map((clip) => {
        const time = formatBookmarkTime({ positionSec: clip.startSec, endSec: clip.endSec })
        return (
          <Pressable
            key={clip.key}
            onPress={() => onSelect(clip)}
            accessibilityLabel={`${clip.title}, ${time}`}
            style={styles.clipRow}
          >
            <View style={styles.timeChip}>
              <Text style={styles.timeText}>{time}</Text>
            </View>
            <Text style={styles.clipTitle} numberOfLines={2}>
              {clip.title}
            </Text>
          </Pressable>
        )
      })
    )

  const renderGroup = (group: CompareGroup) => {
    const state = opened[group.key]
    return (
      <View key={group.key} style={styles.group}>
        <Pressable
          onPress={() => toggleGroup(group)}
          disabled={!group.loadClips}
          accessibilityRole={group.loadClips ? "button" : "none"}
          accessibilityState={group.loadClips ? { expanded: !!state } : undefined}
          style={styles.groupHead}
        >
          <View style={styles.groupText}>
            <Text style={styles.groupTitle} numberOfLines={2}>
              {group.title}
            </Text>
            {group.subtitle ? (
              <Text style={styles.muted} numberOfLines={1}>
                {group.subtitle}
              </Text>
            ) : null}
          </View>
          {group.loadClips && (
            <Text style={styles.chevron}>{state ? "▾" : "▸"}</Text>
          )}
        </Pressable>
        {group.clips && renderClips(group.clips)}
        {state?.status === "loading" && (
          <ActivityIndicator color={theme.colors.accent} />
        )}
        {state?.status === "error" && <Text style={styles.error}>{state.message}</Text>}
        {state?.status === "ready" && renderClips(state.data)}
      </View>
    )
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      supportedOrientations={["portrait", "landscape"]}
    >
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          onAccessibilityEscape={onClose}
          accessibilityRole="none"
        >
          <Pressable
            style={styles.sheet}
            accessibilityRole="none"
            onPress={() => {
              /* swallow, so a tap inside the sheet doesn't dismiss it */
            }}
          >
            <Text style={styles.title}>{title}</Text>
            <View style={styles.tabs}>
              {COMPARE_SOURCES.map((s, i) => (
                <Pressable
                  key={s.id}
                  onPress={() => setSourceIndex(i)}
                  accessibilityState={{ selected: i === sourceIndex }}
                  style={[styles.tab, i === sourceIndex && styles.tabActive]}
                >
                  <Text
                    style={[styles.tabText, i === sourceIndex && styles.tabTextActive]}
                  >
                    {s.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={source.searchPlaceholder}
              placeholderTextColor={theme.colors.mutedFaint}
              returnKeyType="search"
              style={styles.search}
            />
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
            >
              {groups.status === "loading" ? (
                <ActivityIndicator color={theme.colors.accent} />
              ) : groups.status === "error" ? (
                <Text style={styles.error}>{groups.message}</Text>
              ) : groups.data.length === 0 ? (
                <Text style={styles.muted}>Ничего не нашлось</Text>
              ) : (
                groups.data.map(renderGroup)
              )}
            </ScrollView>
            <Pressable onPress={onClose} style={styles.cancel}>
              <Text style={styles.cancelText}>Отмена</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    backdrop: {
      flex: 1,
      backgroundColor: theme.colors.overlay,
      justifyContent: "center",
      alignItems: "center",
      padding: theme.spacing(5),
    },
    sheet: {
      width: "100%",
      maxWidth: 560,
      maxHeight: "92%",
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.radius.lg,
      padding: theme.spacing(4),
      gap: theme.spacing(3),
      ...theme.shadows.sm,
    },
    title: { fontSize: 18, fontWeight: "700", color: theme.colors.text },
    tabs: { flexDirection: "row", gap: theme.spacing(2), flexWrap: "wrap" },
    tab: {
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(1) + 2,
      borderRadius: theme.radius.full,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceMuted,
    },
    tabActive: {
      backgroundColor: theme.colors.accent,
      borderColor: theme.colors.accent,
    },
    tabText: { fontSize: 13, fontWeight: "600", color: theme.colors.text },
    tabTextActive: { color: theme.colors.accentText },
    search: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2),
      fontSize: 14,
      color: theme.colors.text,
      backgroundColor: theme.colors.surfaceMuted,
    },
    list: { flexGrow: 0 },
    listContent: { gap: theme.spacing(3), paddingBottom: theme.spacing(2) },
    group: { gap: theme.spacing(1) + 2 },
    groupHead: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
    },
    groupText: { flex: 1, gap: 2 },
    groupTitle: { fontSize: 14, fontWeight: "700", color: theme.colors.text },
    chevron: { fontSize: 16, color: theme.colors.muted },
    clipRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(2),
      paddingVertical: theme.spacing(1) + 2,
      paddingHorizontal: theme.spacing(2),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceMuted,
    },
    timeChip: {
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 2,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    timeText: {
      fontSize: 13,
      fontWeight: "700",
      color: theme.colors.accent,
      fontVariant: ["tabular-nums"],
    },
    clipTitle: { flex: 1, fontSize: 13, color: theme.colors.text },
    muted: { ...theme.typography.caption },
    error: { fontSize: 13, color: theme.colors.danger },
    cancel: { alignSelf: "flex-end", paddingVertical: theme.spacing(2) },
    cancelText: { fontSize: 14, fontWeight: "600", color: theme.colors.accent },
  })
