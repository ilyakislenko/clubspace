import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import { getClubTournamentResults, type ClubTournamentResults } from "../../shared/api/tournaments"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import { CenteredColumn, READABLE_WIDTH } from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { RefreshControl } from "../../shared/components/RefreshControl"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { personName, resultsDivisions } from "./tournament-helpers"

type Props = NativeStackScreenProps<RootStackParamList, "TournamentResults">

/**
 * «Итоги турнира»: the podium of every division (1 · 2 · 3 · 3), the
 * viewer's club marked. Nothing else.
 */
export function TournamentResultsScreen({ route }: Props) {
  const { workspaceId, eventId } = route.params
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const results = useCachedResource<ClubTournamentResults>(
    `tournament-results:${workspaceId}:${eventId}`,
    useCallback(async () => await getClubTournamentResults({ workspaceId, eventId }), [workspaceId, eventId]),
  )
  const data = results.data

  if (results.loading && !data) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl refreshing={results.refreshing} onRefresh={results.refetch} tintColor={theme.colors.accent} />
          }
        >
          {results.error && !data && <ErrorRetry message={results.error} onRetry={results.refetch} />}
          {results.stale && data ? <OfflineNotice /> : null}
          {data &&
            resultsDivisions(data.divisions).map((d) => (
              <View key={d.divisionId} style={styles.division}>
                <Text style={styles.divisionName}>{d.name}</Text>
                {[...d.podium]
                  .sort((a, b) => a.place - b.place)
                  .map((p, i) => (
                    <View key={i} style={styles.row}>
                      <Text style={styles.place}>{p.place}</Text>
                      <View style={styles.rowText}>
                        <Text style={[styles.name, p.isMe && styles.me]} numberOfLines={1}>
                          {personName(p)}
                        </Text>
                        {!p.hidden && p.clubName && (
                          <Text style={[styles.club, p.isMyClub && styles.myClub]} numberOfLines={1}>
                            {p.clubName}
                          </Text>
                        )}
                      </View>
                    </View>
                  ))}
              </View>
            ))}
        </ScrollView>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.background },
    body: { padding: theme.spacing(5), gap: theme.spacing(5) },
    division: { gap: theme.spacing(1) },
    divisionName: { ...theme.typography.bodyStrong, color: theme.colors.text },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      minHeight: 44,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
    },
    place: { width: 20, fontSize: 15, fontWeight: "700", color: theme.colors.textSecondary, textAlign: "center" },
    rowText: { flex: 1 },
    name: { fontSize: 15, color: theme.colors.text },
    me: { fontWeight: "700", color: theme.colors.accent },
    club: { fontSize: 12, color: theme.colors.muted },
    myClub: { color: theme.colors.text, fontWeight: "600" },
  })
