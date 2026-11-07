import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import { useFocusEffect } from "@react-navigation/native"
import { useNetworkState } from "expo-network"
import React, { useCallback, useEffect, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import {
  listMyVideoNotes,
  type MyVideoBookmark,
  type MyVideoNotesItem,
} from "../../shared/api/video-study"
import { useAuth } from "../../shared/auth-context"
import { readResource, writeResource } from "../../shared/cache/resource-cache"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { PlayGlyph } from "../../shared/components/PlayGlyph"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { TextInput } from "../../shared/components/TextInput"
import { errorMessage } from "../../shared/error-message"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import type { Theme } from "../../shared/theme"
import {
  flushStudyData,
  mergeVideoNotesIntoStudy,
  readLocalStudy,
  studyFiles,
} from "../profile/preferences-store"
import { filterVideoNotes, overlayLocalStudy } from "../profile/study-merge"
import type { RootStackParamList } from "../../app/navigation"
import { formatBookmarkTime } from "./format-position"

type Props = NativeStackScreenProps<RootStackParamList, "MyVideoNotes">

const SEARCH_DEBOUNCE_MS = 350
// Past this a note is clamped to NOTE_LINES with «Ещё» to unfold it.
const NOTE_LINES = 3
const isLongNote = (text: string) =>
  text.length > 160 || text.split("\n").length > NOTE_LINES

// The last unfiltered list, per club (and per profile — the cache is).
const cacheKey = (workspaceId: string) => `my-video-notes:${workspaceId}`

// Every lesson the member keeps a note or bookmarks on, searchable. Online it
// asks the server (after sending notes written offline, so they're in it);
// offline it shows the last list it got, with this device's newer edits laid
// over it, and searches that.
export function MyVideoNotesScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const network = useNetworkState()
  // Unknown counts as online: a request is tried and fails into the cache.
  const online =
    network.isConnected !== false && network.isInternetReachable !== false

  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [items, setItems] = useState<MyVideoNotesItem[]>([])
  const [offline, setOffline] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  // Only the latest load may paint.
  const loadSeq = useRef(0)
  const searchRef = useRef(search)
  searchRef.current = search
  const onlineRef = useRef(online)
  onlineRef.current = online

  useEffect(() => {
    const id = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])

  const load = useCallback(
    async (q: string, flush: boolean) => {
      if (!workspace) return
      const seq = ++loadSeq.current
      const workspaceId = workspace.workspaceId
      // The profile the answer belongs to; a switch mid-request drops it.
      const scope = studyFiles()
      try {
        if (!onlineRef.current) throw new Error("offline")
        if (flush) await flushStudyData()
        const response = await listMyVideoNotes({ workspaceId, q })
        if (!(await mergeVideoNotesIntoStudy(scope, response.items))) return
        if (!q) await writeResource(cacheKey(workspaceId), response.items)
        if (seq !== loadSeq.current) return
        setItems(response.items)
        setOffline(false)
        setError(null)
      } catch (err) {
        const [cached, local] = await Promise.all([
          readResource<MyVideoNotesItem[]>(cacheKey(workspaceId)),
          readLocalStudy(),
        ])
        if (seq !== loadSeq.current) return
        if (cached) {
          setItems(
            filterVideoNotes(
              overlayLocalStudy(cached.data, local.bookmarks, local.notes),
              q,
            ),
          )
          setOffline(true)
          setError(null)
        } else {
          setError(
            onlineRef.current
              ? errorMessage(err, "Не удалось загрузить заметки.")
              : "Нет сети — заметки загрузятся, когда появится интернет.",
          )
        }
      } finally {
        if (seq === loadSeq.current) setLoading(false)
      }
    },
    [workspace],
  )

  // Every visit (coming back from a lesson included) and every return to the
  // network: send what's unsynced, then reload.
  useFocusEffect(
    useCallback(() => {
      void load(searchRef.current, true)
    }, [load]),
  )
  const wasOnline = useRef(online)
  useEffect(() => {
    if (online && !wasOnline.current) void load(searchRef.current, true)
    wasOnline.current = online
  }, [online, load])

  const searchedOnce = useRef(false)
  useEffect(() => {
    // The first value is the focus load's; only later changes search.
    if (!searchedOnce.current) {
      searchedOnce.current = true
      return
    }
    void load(search, false)
  }, [search, load])

  const handleRefresh = async () => {
    setRefreshing(true)
    await load(searchRef.current, true)
    setRefreshing(false)
  }

  const toggleExpanded = (videoId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(videoId)) next.delete(videoId)
      else next.add(videoId)
      return next
    })

  const openVideo = (item: MyVideoNotesItem, bookmark?: MyVideoBookmark) =>
    navigation.navigate("Video", {
      videoId: item.video.id,
      courseId: item.course?.id,
      title: item.video.title,
      startAt: bookmark?.positionSec,
      loopEndAt: bookmark?.endSec ?? undefined,
    })

  const renderItem = ({ item }: { item: MyVideoNotesItem }) => {
    const open = expanded.has(item.video.id)
    const noteText = item.note?.text ?? ""
    const long = isLongNote(noteText)
    return (
      <View style={styles.card}>
        <Pressable
          onPress={() => openVideo(item)}
          accessibilityRole="button"
          accessibilityLabel={`Открыть видео ${item.video.title}`}
          style={({ pressed }) => [styles.head, pressed && styles.pressed]}
        >
          {item.video.thumbnailUrl ? (
            <Image
              source={{ uri: item.video.thumbnailUrl }}
              style={styles.thumb}
            />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <PlayGlyph />
            </View>
          )}
          <View style={styles.headText}>
            <Text style={styles.title} numberOfLines={2}>
              {item.video.title}
            </Text>
            {item.course && (
              <Text style={styles.muted} numberOfLines={1}>
                {item.course.title}
              </Text>
            )}
          </View>
        </Pressable>

        {noteText.length > 0 && (
          <Pressable
            onPress={long ? () => toggleExpanded(item.video.id) : undefined}
            disabled={!long}
            accessibilityRole={long ? "button" : undefined}
            accessibilityLabel={
              long ? (open ? "Свернуть заметку" : "Показать заметку целиком") : undefined
            }
          >
            <Text
              style={styles.note}
              numberOfLines={long && !open ? NOTE_LINES : undefined}
            >
              {noteText}
            </Text>
            {long && (
              <Text style={styles.more}>{open ? "Свернуть" : "Ещё"}</Text>
            )}
          </Pressable>
        )}

        {item.bookmarks.length > 0 && (
          <View style={styles.bookmarks}>
            {item.bookmarks.map((b) => (
              <Pressable
                key={b.id}
                onPress={() => openVideo(item, b)}
                accessibilityRole="button"
                accessibilityLabel={`${b.label || "Закладка"}, ${formatBookmarkTime(b)} — открыть видео с этого места`}
                style={({ pressed }) => [
                  styles.bookmarkRow,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.timeChip}>
                  <Text style={styles.timeText}>{formatBookmarkTime(b)}</Text>
                </View>
                <View style={styles.bookmarkText}>
                  <Text
                    style={b.label ? styles.bookmarkLabel : styles.bookmarkLabelEmpty}
                    numberOfLines={1}
                  >
                    {b.label || "Без названия"}
                  </Text>
                  {b.note ? (
                    <Text style={styles.bookmarkNote} numberOfLines={2}>
                      {b.note}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <View style={styles.top}>
          <View>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Поиск по видео, заметкам и закладкам"
              placeholderTextColor={theme.colors.muted}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {query.length > 0 && (
              <Pressable
                onPress={() => setQuery("")}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Очистить поиск"
                style={styles.searchClear}
              >
                <Text style={styles.searchClearText}>✕</Text>
              </Pressable>
            )}
          </View>
          {offline && <OfflineNotice message="Нет сети — показаны сохранённые" />}
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : error ? (
          <ErrorRetry message={error} onRetry={() => void handleRefresh()} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.video.id}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void handleRefresh()}
                tintColor={theme.colors.accent}
              />
            }
            contentContainerStyle={
              items.length === 0 ? styles.emptyWrap : styles.list
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>
                  {search ? "Ничего не нашлось" : "Пока нет заметок"}
                </Text>
                <Text style={styles.emptyHint}>
                  {search
                    ? "Попробуйте другое слово."
                    : "Добавляйте закладки и заметки под видео — они соберутся здесь и будут на всех ваших устройствах."}
                </Text>
              </View>
            }
          />
        )}
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    top: {
      paddingHorizontal: theme.spacing(5),
      paddingTop: theme.spacing(3),
      gap: theme.spacing(2),
    },
    searchInput: {
      height: 44,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing(4),
      paddingRight: theme.spacing(10),
      fontSize: 15,
      color: theme.colors.text,
      backgroundColor: theme.colors.surfaceMuted,
    },
    searchClear: {
      position: "absolute",
      right: theme.spacing(2),
      top: 0,
      bottom: 0,
      width: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    searchClearText: {
      fontSize: 14,
      color: theme.colors.muted,
      fontWeight: "600",
    },
    list: {
      padding: theme.spacing(5),
      paddingTop: theme.spacing(3),
      gap: theme.spacing(3),
    },
    card: {
      gap: theme.spacing(3),
      padding: theme.spacing(3),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    head: {
      flexDirection: "row",
      gap: theme.spacing(3),
      alignItems: "center",
    },
    pressed: { opacity: 0.85 },
    thumb: {
      width: 100,
      height: 60,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceMuted,
    },
    thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    headText: { flex: 1, gap: 3 },
    title: {
      color: theme.colors.text,
      fontSize: 15,
      fontWeight: "600",
    },
    muted: { fontSize: 12, color: theme.colors.muted },
    note: {
      ...theme.typography.body,
      color: theme.colors.text,
    },
    more: {
      marginTop: 2,
      fontSize: 12,
      fontWeight: "600",
      color: theme.colors.accent,
    },
    bookmarks: { gap: theme.spacing(2) },
    bookmarkRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: theme.spacing(2),
    },
    timeChip: {
      paddingHorizontal: theme.spacing(2),
      paddingVertical: 4,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceMuted,
    },
    timeText: {
      fontSize: 13,
      fontWeight: "700",
      color: theme.colors.accent,
      fontVariant: ["tabular-nums"],
    },
    bookmarkText: { flex: 1, gap: 2, paddingTop: 3 },
    bookmarkLabel: {
      fontSize: 14,
      fontWeight: "600",
      color: theme.colors.text,
    },
    bookmarkLabelEmpty: {
      fontSize: 14,
      color: theme.colors.muted,
    },
    bookmarkNote: { fontSize: 13, color: theme.colors.muted },
    empty: {
      alignItems: "center",
      paddingHorizontal: theme.spacing(8),
    },
    emptyWrap: { flex: 1, justifyContent: "center" },
    emptyTitle: {
      ...theme.typography.heading,
      color: theme.colors.text,
      marginBottom: theme.spacing(2),
    },
    emptyHint: {
      ...theme.typography.body,
      color: theme.colors.muted,
      textAlign: "center",
    },
  })
