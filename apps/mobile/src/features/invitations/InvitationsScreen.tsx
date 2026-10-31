import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import React, { useState } from "react"
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native"

import { navigateToTab, type RootStackParamList } from "../../app/navigation"
import { useAuth } from "../../shared/auth-context"
import { CenteredColumn, READABLE_WIDTH } from "../../shared/components/CenteredColumn"
import { ErrorRetry } from "../../shared/components/ErrorRetry"
import { RefreshControl } from "../../shared/components/RefreshControl"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import { InvitationList } from "./InvitationList"
import { useMyInvitations } from "./useMyInvitations"

type Props = NativeStackScreenProps<RootStackParamList, "Invitations">

export function InvitationsScreen(_props: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const { workspaces } = useAuth()
  const { invitations, failed, reload } = useMyInvitations()
  const [refreshing, setRefreshing] = useState(false)

  const onRefresh = async () => {
    setRefreshing(true)
    await reload()
    setRefreshing(false)
  }

  return (
    <View style={styles.root}>
      <CenteredColumn maxWidth={READABLE_WIDTH}>
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={theme.colors.accent}
            />
          }
        >
          {failed && !invitations ? (
            <ErrorRetry
              message="Не удалось загрузить приглашения"
              onRetry={() => void reload()}
            />
          ) : !invitations ? (
            <ActivityIndicator color={theme.colors.accent} />
          ) : invitations.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Приглашений нет</Text>
              <Text style={styles.emptyText}>
                Когда клуб пригласит вас по email, приглашение появится здесь.
              </Text>
            </View>
          ) : (
            <InvitationList
              invitations={invitations}
              onChanged={reload}
              // Without a club the app swaps to the member screens by itself;
              // otherwise take the member into the club they just joined.
              onAccepted={() => {
                if (workspaces.length > 0) navigateToTab("Home")
              }}
            />
          )}
        </ScrollView>
      </CenteredColumn>
    </View>
  )
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.colors.background },
    body: { padding: theme.spacing(5), gap: theme.spacing(4) },
    empty: {
      alignItems: "center",
      gap: theme.spacing(2),
      paddingVertical: theme.spacing(10),
    },
    emptyTitle: { ...theme.typography.subheading, color: theme.colors.text },
    emptyText: {
      ...theme.typography.body,
      color: theme.colors.muted,
      textAlign: "center",
    },
  })
