import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useCallback, useEffect, useState } from "react"
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { listGyms, type GymCard } from "../../shared/api/groups"
import { useAuth } from "../../shared/auth-context"
import { errorMessage } from "../../shared/error-message"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { theme } from "../../shared/theme"
import type { RootStackParamList } from "../../app/navigation"

type Props = NativeStackScreenProps<RootStackParamList, "Gyms">

// Hands the gym off to whatever maps app the user has installed.
// Apple Maps on iOS, Google Maps on Android — both honour `geo:` and
// also have their own URL schemes as fallback. We try `geo:` first
// (cross-platform with coordinates), then platform-specific URLs that
// will accept just an address if we don't have coordinates.
const openInMaps = (gym: GymCard) => {
  const label = encodeURIComponent(gym.name)
  if (gym.lat != null && gym.lng != null) {
    const geo = `geo:${gym.lat},${gym.lng}?q=${gym.lat},${gym.lng}(${label})`
    void Linking.openURL(geo).catch(() => {
      // Older iOS doesn't honour geo: — fall back to Apple Maps
      void Linking.openURL(
        `https://maps.apple.com/?q=${label}&ll=${gym.lat},${gym.lng}`,
      )
    })
    return
  }
  // No coordinates — pass the address as a search query.
  const q = encodeURIComponent(gym.address)
  if (Platform.OS === "ios") {
    void Linking.openURL(`https://maps.apple.com/?q=${q}`)
  } else {
    void Linking.openURL(`geo:0,0?q=${q}`)
  }
}

export function GymsScreen({ navigation }: Props) {
  const { workspace } = useAuth()
  const [gyms, setGyms] = useState<GymCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!workspace) return
    try {
      const data = await listGyms({ workspaceId: workspace.workspaceId })
      setGyms(data)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить"))
      setGyms([])
    }
  }, [workspace])

  useEffect(() => {
    void load()
  }, [load])

  if (gyms === null) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator color={theme.colors.accent} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>Залы</Text>
        <Text style={styles.subtitle}>
          Места, где проходят тренировки клуба. Тап «Открыть в картах»
          построит маршрут в стандартном картографическом приложении.
        </Text>

        {error ? (
          <ErrorRetry message={error} onRetry={() => void load()} />
        ) : gyms.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Залов пока нет</Text>
            <Text style={styles.emptyText}>
              Когда клуб добавит зал в админке — он появится здесь.
            </Text>
            <Pressable
              onPress={() => navigation.goBack()}
              style={styles.emptyButton}
            >
              <Text style={styles.emptyButtonText}>Назад</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.list}>
            {gyms.map((gym) => (
              <View key={gym.id} style={styles.card}>
                <Text style={styles.cardName}>{gym.name}</Text>
                <Text style={styles.cardAddress}>{gym.address}</Text>
                <View style={styles.cardRow}>
                  <Text style={styles.cardMeta}>
                    {gym.groupCount} группа(ы)
                  </Text>
                  <Pressable
                    onPress={() => openInMaps(gym)}
                    style={styles.cardButton}
                  >
                    <Text style={styles.cardButtonText}>
                      Открыть в картах →
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
  body: {
    padding: theme.spacing(5),
    gap: theme.spacing(3),
  },
  title: {
    ...theme.typography.title,
    fontSize: 24,
    color: theme.colors.text,
  },
  subtitle: {
    ...theme.typography.body,
    color: theme.colors.muted,
  },
  empty: {
    alignItems: "center",
    gap: theme.spacing(2),
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
  emptyText: {
    ...theme.typography.caption,
    color: theme.colors.muted,
    textAlign: "center",
  },
  emptyButton: {
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(2),
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginTop: theme.spacing(2),
  },
  emptyButtonText: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: "500",
  },
  list: { gap: theme.spacing(2) },
  card: {
    gap: theme.spacing(1),
    padding: theme.spacing(4),
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surfaceElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...theme.shadows.sm,
  },
  cardName: {
    ...theme.typography.subheading,
    color: theme.colors.text,
  },
  cardAddress: {
    color: theme.colors.muted,
    fontSize: 13,
  },
  cardRow: {
    marginTop: theme.spacing(1),
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardMeta: {
    color: theme.colors.muted,
    fontSize: 12,
  },
  cardButton: {
    paddingHorizontal: theme.spacing(3),
    paddingVertical: theme.spacing(1) + 2,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.accent,
  },
  cardButtonText: {
    color: theme.colors.accentText,
    fontSize: 13,
    fontWeight: "600",
  },
})
