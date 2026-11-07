import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useMemo, useState } from "react"
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import { listTechniques, type TechniqueSummary } from "../../shared/api/techniques"
import { useAuth } from "../../shared/auth-context"
import { useCachedResource } from "../../shared/cache/useCachedResource"
import {
  CenteredColumn,
  READABLE_WIDTH,
} from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { Pressable } from "../../shared/components/Pressable"
import { TextInput } from "../../shared/components/TextInput"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  filterTechniqueGroups,
  techniqueCountLabel,
  techniqueName,
} from "./technique-helpers"

type Props = NativeStackScreenProps<RootStackParamList, "Techniques">

// «Техники»: the club sport's techniques, by category, that are taught in
// lessons this member may watch — named in a chapter or said in the lesson.
// The last copy stays on the device, so it works offline too.
export function TechniquesScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspace } = useAuth()
  const workspaceId = workspace?.workspaceId
  const [query, setQuery] = useState("")

  const catalogue = useCachedResource(
    workspaceId ? `techniques:${workspaceId}` : null,
    useCallback(async () => await listTechniques({ workspaceId: workspaceId! }), [workspaceId]),
  )
  const sections = useMemo(
    () =>
      filterTechniqueGroups(catalogue.data?.categories ?? [], query).map((g) => ({
        key: g.category,
        title: g.label,
        data: g.techniques,
      })),
    [catalogue.data, query],
  )

  const renderItem = ({ item }: { item: TechniqueSummary }) => {
    const name = techniqueName(item)
    return (
      <Pressable
        onPress={() => navigation.navigate("Technique", { key: item.key, title: name })}
        accessibilityRole="button"
        accessibilityLabel={`${name}: ${techniqueCountLabel(item)}`}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <View style={styles.rowText}>
          <Text style={styles.name} numberOfLines={2}>
            {name}
          </Text>
          <Text style={styles.muted}>{techniqueCountLabel(item)}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    )
  }

  const empty = (() => {
    if (catalogue.loading && !catalogue.data) {
      return <ActivityIndicator color={theme.colors.accent} />
    }
    if (catalogue.error && !catalogue.data) {
      return <ErrorRetry message={catalogue.error} onRetry={catalogue.refetch} />
    }
    if (query.trim()) {
      return (
        <>
          <Text style={styles.stateTitle}>Ничего не нашлось</Text>
          <Text style={styles.stateHint}>Попробуйте по-английски или по-русски.</Text>
        </>
      )
    }
    return (
      <>
        <Text style={styles.stateTitle}>Техник пока нет</Text>
        <Text style={styles.stateHint}>
          Здесь появятся техники, которые разбирают в видео клуба, — по главам и
          по тому, что говорят в уроке.
        </Text>
      </>
    )
  })()

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <View style={styles.top}>
          <View>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Найти технику: «кимура», «guard»"
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
        </View>
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => (
            <Text style={styles.section} accessibilityRole="header">
              {section.title}
            </Text>
          )}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={catalogue.refreshing}
              onRefresh={catalogue.refetch}
              tintColor={theme.colors.accent}
            />
          }
          contentContainerStyle={sections.length > 0 ? styles.list : styles.emptyWrap}
          ListEmptyComponent={<View style={styles.state}>{empty}</View>}
        />
      </CenteredColumn>
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
    top: {
      paddingHorizontal: theme.spacing(5),
      paddingTop: theme.spacing(3),
      paddingBottom: theme.spacing(1),
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
    searchClearText: { fontSize: 14, color: theme.colors.muted, fontWeight: "600" },
    list: {
      paddingHorizontal: theme.spacing(5),
      paddingBottom: theme.spacing(5),
      gap: theme.spacing(2),
    },
    section: {
      ...theme.typography.label,
      marginTop: theme.spacing(4),
      marginBottom: theme.spacing(1),
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.spacing(3),
      paddingVertical: theme.spacing(3),
      paddingHorizontal: theme.spacing(4),
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
      marginBottom: theme.spacing(2),
    },
    rowText: { flex: 1, gap: 2 },
    name: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
    chevron: { fontSize: 22, color: theme.colors.muted },
  })
