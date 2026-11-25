import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback } from "react"
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import {
  listMyClubMessages,
  type MyClubMessage,
} from "../../shared/api/messages"
import { useAuth } from "../../shared/auth-context"
import { useVocabulary } from "../../shared/use-vocabulary"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { formatMessageDate, markReadInList } from "./club-messages"

type Props = NativeStackScreenProps<RootStackParamList, "ClubMessages">

/**
 * «Сообщения клуба»: every message the club sent this member (or the child
 * acted for), also those whose push was switched off. A dot = not opened yet;
 * opening the message itself is «открыли».
 */
export function ClubMessagesScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const vocabulary = useVocabulary()
  const workspaceId = workspace?.workspaceId

  // `club-messages:<club>`: the server signals it when a message reaches this
  // member or one of their children (deliver.ts).
  const { data, error, loading, refreshing, stale, refetch, mutate } =
    useCachedResource<MyClubMessage[]>(
      workspaceId ? `club-messages:${workspaceId}` : null,
      useCallback(
        // The key is null without a club, so this never runs without one.
        async () =>
          workspaceId
            ? (await listMyClubMessages({ workspaceId })).data
            : [],
        [workspaceId],
      ),
    )

  if (!workspace) return null

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  const items = data ?? []
  const now = new Date()

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <FlatList
          data={items}
          keyExtractor={(m) => m.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refetch} />
          }
          contentContainerStyle={
            items.length === 0 ? styles.emptyContent : styles.listContent
          }
          ListHeaderComponent={stale && data ? <OfflineNotice /> : undefined}
          ListEmptyComponent={
            error ? (
              <ErrorRetry message={error} onRetry={refetch} />
            ) : (
              <Text style={styles.emptyText}>
                {`Здесь появятся сообщения от клуба: о ${vocabulary.session.prepPl}, оплате и изменениях в расписании.`}
              </Text>
            )
          }
          renderItem={({ item }) => {
            const unread = item.readAt === null
            return (
              <Pressable
                onPress={() => {
                  // The message screen stamps it read; the dot goes now, not
                  // after the next fetch.
                  mutate((prev) =>
                    prev
                      ? markReadInList(prev, item.id, new Date().toISOString())
                      : prev,
                  )
                  navigation.navigate("ClubMessage", { messageId: item.id })
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  unread ? `${item.title}, не прочитано` : item.title
                }
                style={styles.row}
              >
                <View style={styles.dotColumn}>
                  {unread ? <View style={styles.dot} /> : null}
                </View>
                <View style={styles.body}>
                  <Text
                    style={[styles.title, unread && styles.titleUnread]}
                    numberOfLines={2}
                  >
                    {item.title}
                  </Text>
                  <Text style={styles.preview} numberOfLines={2}>
                    {item.body}
                  </Text>
                  <Text style={styles.meta}>
                    {item.sentAt
                      ? `${item.authorName} · ${formatMessageDate(item.sentAt, now)}`
                      : item.authorName}
                  </Text>
                </View>
              </Pressable>
            )
          }}
        />
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.surface },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.surface,
    },
    listContent: { padding: theme.spacing(3), gap: theme.spacing(2) },
    emptyContent: {
      flexGrow: 1,
      justifyContent: "center",
      padding: theme.spacing(6),
    },
    emptyText: { ...theme.typography.caption, textAlign: "center" },
    row: {
      flexDirection: "row",
      gap: theme.spacing(2),
      padding: theme.spacing(3),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surfaceMuted,
    },
    dotColumn: { width: 10, paddingTop: 6, alignItems: "center" },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.colors.accent,
    },
    body: { flex: 1, gap: 2 },
    title: { fontSize: 15, fontWeight: "500", color: theme.colors.text },
    titleUnread: { fontWeight: "700" },
    preview: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      lineHeight: 19,
    },
    meta: {
      fontSize: 12,
      color: theme.colors.mutedFaint,
      marginTop: theme.spacing(1),
    },
  })
