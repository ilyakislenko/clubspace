import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useLayoutEffect, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import { getTechnique, type TechniqueVideo } from "../../shared/api/techniques"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { PlayGlyph } from "../../shared/components/PlayGlyph"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { AddToPlanModal } from "../study-plans/AddToPlanModal"
import { draftFromTechniqueMoment, type PlanItemDraft } from "../study-plans/plan-drafts"
import { MomentChip } from "../video-search/SearchMoment"
import { techniqueName } from "./technique-helpers"

type Props = NativeStackScreenProps<RootStackParamList, "Technique">

// One technique: the lessons that teach it — the ones with a chapter on it
// first — and the moments in each; a tap opens the lesson right there, «В план»
// puts the moment into a study plan. Cached for offline.
export function TechniqueScreen({ route, navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const workspaceId = workspace?.workspaceId
  const { key } = route.params
  const [planDraft, setPlanDraft] = useState<PlanItemDraft | null>(null)

  const detail = useCachedResource(
    workspaceId ? `technique:${workspaceId}:${key}` : null,
    useCallback(
      async () => await getTechnique({ workspaceId: workspaceId!, key }),
      [workspaceId, key],
    ),
  )
  const name = detail.data ? techniqueName(detail.data.technique) : (route.params.title ?? "")

  useLayoutEffect(() => {
    if (name) navigation.setOptions({ title: name })
  }, [navigation, name])

  const open = (item: TechniqueVideo, atSec?: number) =>
    navigation.navigate("Video", {
      videoId: item.video.id,
      courseId: item.course?.id,
      title: item.video.title,
      startAt: atSec,
    })

  const renderItem = ({ item }: { item: TechniqueVideo }) => (
    <View style={styles.card}>
      <Pressable
        onPress={() => open(item)}
        accessibilityRole="button"
        accessibilityLabel={`Открыть видео ${item.video.title}`}
        style={({ pressed }) => [styles.head, pressed && styles.pressed]}
      >
        {item.video.thumbnailUrl ? (
          <Image source={{ uri: item.video.thumbnailUrl }} style={styles.thumb} />
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
      <View style={styles.moments}>
        {item.moments.map((moment, i) => (
          <View key={`${moment.atSec}-${moment.kind}-${i}`} style={styles.momentRow}>
            <View style={styles.momentChip}>
              <MomentChip moment={moment} onPress={() => open(item, moment.atSec)} />
            </View>
            <Pressable
              onPress={() =>
                setPlanDraft(draftFromTechniqueMoment(item.video.id, moment.atSec, name))
              }
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Добавить в план: ${name}, ${item.video.title}`}
              style={({ pressed }) => [styles.planButton, pressed && styles.pressed]}
            >
              <Text style={styles.planText}>В план</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  )

  const empty = (() => {
    if (detail.loading && !detail.data) {
      return <ActivityIndicator color={theme.colors.accent} />
    }
    if (detail.error && !detail.data) {
      return <ErrorRetry message={detail.error} onRetry={detail.refetch} />
    }
    return (
      <>
        <Text style={styles.stateTitle}>Уроков с этой техникой нет</Text>
        <Text style={styles.stateHint}>
          Возможно, видео с ней вам пока не открыты.
        </Text>
      </>
    )
  })()

  const items = detail.data?.items ?? []
  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <FlatList
          data={items}
          keyExtractor={(item) => item.video.id}
          renderItem={renderItem}
          ListHeaderComponent={
            detail.data ? (
              <Text style={styles.category}>{detail.data.technique.categoryLabel}</Text>
            ) : undefined
          }
          refreshControl={
            <RefreshControl
              refreshing={detail.refreshing}
              onRefresh={detail.refetch}
              tintColor={theme.colors.accent}
            />
          }
          contentContainerStyle={items.length > 0 ? styles.list : styles.emptyWrap}
          ListEmptyComponent={<View style={styles.state}>{empty}</View>}
        />
      </CenteredColumn>
      {planDraft && <AddToPlanModal draft={planDraft} onClose={() => setPlanDraft(null)} />}
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    pressed: { opacity: 0.85 },
    muted: { fontSize: 12, color: theme.colors.muted },
    emptyWrap: { flexGrow: 1, justifyContent: "center" },
    state: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing(2),
      paddingHorizontal: theme.spacing(8),
      paddingVertical: theme.spacing(8),
    },
    stateTitle: {
      ...theme.typography.heading,
      color: theme.colors.text,
      textAlign: "center",
    },
    stateHint: { ...theme.typography.body, color: theme.colors.muted, textAlign: "center" },
    list: {
      padding: theme.spacing(5),
      paddingTop: theme.spacing(3),
      gap: theme.spacing(3),
    },
    category: { ...theme.typography.label },
    card: {
      gap: theme.spacing(3),
      padding: theme.spacing(3),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    head: { flexDirection: "row", gap: theme.spacing(3), alignItems: "center" },
    thumb: {
      width: 100,
      height: 60,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceMuted,
    },
    thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
    headText: { flex: 1, gap: 3 },
    title: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
    moments: { gap: theme.spacing(2) },
    momentRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing(2) },
    momentChip: { flex: 1 },
    planButton: {
      paddingHorizontal: theme.spacing(3),
      paddingVertical: theme.spacing(2),
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    planText: { fontSize: 13, fontWeight: "600", color: theme.colors.accent },
  })
