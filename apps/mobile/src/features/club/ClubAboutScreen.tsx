import React, { useCallback } from "react"
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { getClubAbout, type ClubAbout } from "../../shared/api/club-about"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { OfflineNotice } from "../../shared/components/OfflineNotice"
import { Pressable } from "../../shared/components/Pressable"
import { RefreshControl } from "../../shared/components/RefreshControl"
import { ResponsiveGrid } from "../../shared/components/ResponsiveGrid"
import { formatPhone } from "../../shared/format-ru"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { paragraphs, telUrl } from "./club-about-helpers"

export function ClubAboutScreen() {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()

  const { data, error, loading, refreshing, stale, refetch } =
    useCachedResource<ClubAbout>(
      workspace ? `about:${workspace.workspaceId}` : null,
      useCallback(
        async () => await getClubAbout({ workspaceId: workspace!.workspaceId }),
        [workspace],
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

  const rules = paragraphs(data?.rules ?? null)
  const isEmpty =
    !!data &&
    data.contacts.length === 0 &&
    data.links.length === 0 &&
    rules.length === 0

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={refetch}
              tintColor={theme.colors.accent}
            />
          }
        >
          {stale && data ? <OfflineNotice /> : null}

          {error && !data ? (
            <ErrorRetry message={error} onRetry={refetch} />
          ) : isEmpty ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>
                Клуб пока не заполнил информацию
              </Text>
            </View>
          ) : data ? (
            <>
              {data.contacts.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Контакты</Text>
                  <ResponsiveGrid columns={{ medium: 2, expanded: 2 }}>
                    {data.contacts.map((c, i) => (
                      <Pressable
                        key={`${c.phone}-${i}`}
                        style={styles.card}
                        onPress={() => void Linking.openURL(telUrl(c.phone))}
                      >
                        <Text style={styles.cardLabel}>{c.label}</Text>
                        <Text style={styles.cardLink}>
                          {formatPhone(c.phone)}
                        </Text>
                      </Pressable>
                    ))}
                  </ResponsiveGrid>
                </View>
              )}

              {data.links.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Ссылки</Text>
                  <ResponsiveGrid columns={{ medium: 2, expanded: 2 }}>
                    {data.links.map((l, i) => (
                      <Pressable
                        key={`${l.url}-${i}`}
                        style={styles.card}
                        onPress={() => void Linking.openURL(l.url)}
                      >
                        <Text style={styles.cardLabel}>{l.label}</Text>
                        <Text style={styles.cardLink} numberOfLines={1}>
                          {l.url}
                        </Text>
                      </Pressable>
                    ))}
                  </ResponsiveGrid>
                </View>
              )}

              {rules.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Правила клуба</Text>
                  {rules.map((p, i) => (
                    <Text key={i} style={styles.paragraph}>
                      {p}
                    </Text>
                  ))}
                </View>
              )}
            </>
          ) : null}
        </ScrollView>
      </CenteredColumn>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: theme.colors.background,
    },
    body: {
      padding: theme.spacing(5),
      gap: theme.spacing(5),
    },
    section: { gap: theme.spacing(2) },
    sectionTitle: {
      ...theme.typography.bodyStrong,
      color: theme.colors.text,
    },
    card: {
      flexGrow: 1,
      gap: theme.spacing(1),
      padding: theme.spacing(4),
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      ...theme.shadows.sm,
    },
    cardLabel: { ...theme.typography.caption, color: theme.colors.muted },
    cardLink: { ...theme.typography.body, color: theme.colors.accent },
    paragraph: { ...theme.typography.body, color: theme.colors.text },
    empty: {
      alignItems: "center",
      padding: theme.spacing(6),
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderStyle: "dashed",
    },
    emptyTitle: {
      ...theme.typography.bodyStrong,
      color: theme.colors.text,
      textAlign: "center",
    },
  })
