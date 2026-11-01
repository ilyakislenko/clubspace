import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import { CameraView, useCameraPermissions } from "expo-camera"
import React, { useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Linking, StyleSheet, Text, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { RootStackParamList } from "../../app/navigation"
import { READABLE_WIDTH } from "../../shared/components/CenteredColumn"
import { Pressable } from "../../shared/components/Pressable"
import { isWeb } from "../../shared/platform"
import type { Theme } from "../../shared/theme"
import { useTheme, useThemedStyles } from "../../shared/theme-context"
import {
  createScanHandler,
  NOT_A_CLUB_QR,
  openJoinFromScan,
  scannerView,
} from "./qr-scanner"

type Props = NativeStackScreenProps<RootStackParamList, "ScanJoinQr">

const REJECTED_VISIBLE_MS = 3000

export function ScanJoinQrScreen({ navigation }: Props) {
  const theme = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [permission, requestPermission] = useCameraPermissions()
  const [rejected, setRejected] = useState(false)
  const rejectedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const view = scannerView(permission)

  // Ask right away the first time; the button below covers a dismissed prompt.
  const asked = useRef(false)
  useEffect(() => {
    if (view === "ask" && !asked.current) {
      asked.current = true
      void requestPermission()
    }
  }, [view, requestPermission])

  useEffect(
    () => () => {
      if (rejectedTimer.current) clearTimeout(rejectedTimer.current)
    },
    [],
  )

  const onScan = useMemo(
    () =>
      createScanHandler({
        onCode: (code) => openJoinFromScan(navigation, code),
        onRejected: () => {
          setRejected(true)
          if (rejectedTimer.current) clearTimeout(rejectedTimer.current)
          rejectedTimer.current = setTimeout(
            () => setRejected(false),
            REJECTED_VISIBLE_MS,
          )
        },
      }),
    [navigation],
  )

  const enterManually = () => navigation.popTo("JoinClub", {})

  const manualButton = (
    <Pressable onPress={enterManually} hitSlop={8} accessibilityRole="button">
      <Text style={styles.link}>Ввести код вручную</Text>
    </Pressable>
  )

  if (view === "camera") {
    return (
      <View style={styles.cameraRoot}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => onScan(data)}
        />
        <SafeAreaView style={styles.overlay} edges={["bottom"]}>
          <View style={styles.frame} />
          <View style={styles.sheet}>
            {rejected ? (
              <Text style={styles.rejected} accessibilityLiveRegion="polite">
                {NOT_A_CLUB_QR}
              </Text>
            ) : (
              <Text style={styles.hint}>Наведите камеру на QR-код клуба</Text>
            )}
            {manualButton}
          </View>
        </SafeAreaView>
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={["bottom"]}>
      <View style={styles.center}>
        {view === "checking" ? (
          <ActivityIndicator color={theme.colors.accent} />
        ) : (
          <>
            <Text style={styles.title}>Нужен доступ к камере</Text>
            <Text style={styles.body}>
              {view === "denied"
                ? isWeb
                  ? "Доступ к камере запрещён. Разрешите его в настройках браузера для этого сайта или введите код вручную."
                  : "Доступ к камере запрещён. Разрешите его в настройках, чтобы отсканировать QR-код клуба, или введите код вручную."
                : "Камера нужна, чтобы отсканировать QR-код клуба."}
            </Text>
            {view === "ask" ? (
              <Pressable
                onPress={() => void requestPermission()}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.button,
                  pressed && styles.buttonPressed,
                ]}
              >
                <Text style={styles.buttonText}>Разрешить доступ</Text>
              </Pressable>
            ) : (
              !isWeb && (
                <Pressable
                  onPress={() => void Linking.openSettings()}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.button,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.buttonText}>Открыть настройки</Text>
                </Pressable>
              )
            )}
            {manualButton}
          </>
        )}
      </View>
    </SafeAreaView>
  )
}

const makeStyles = (theme: Theme) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: {
    flex: 1,
    justifyContent: "center",
    gap: theme.spacing(3),
    width: "100%",
    maxWidth: READABLE_WIDTH,
    alignSelf: "center",
    paddingHorizontal: theme.spacing(6),
  },
  title: { ...theme.typography.title, fontSize: 22, color: theme.colors.text },
  body: { ...theme.typography.body, color: theme.colors.muted },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.full,
    paddingVertical: theme.spacing(4),
    alignItems: "center",
    marginTop: theme.spacing(1),
    ...theme.shadows.sm,
  },
  buttonPressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },
  buttonText: {
    color: theme.colors.accentText,
    fontWeight: "700",
    fontSize: 16,
  },
  link: {
    color: theme.colors.accent,
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    paddingVertical: theme.spacing(2),
  },
  cameraRoot: { flex: 1, backgroundColor: theme.colors.playerBg },
  overlay: { flex: 1, justifyContent: "space-between", alignItems: "center" },
  frame: {
    marginTop: "30%",
    width: 240,
    height: 240,
    borderWidth: 3,
    borderColor: theme.colors.onOverlay,
    borderRadius: theme.radius.lg,
  },
  sheet: {
    alignSelf: "stretch",
    gap: theme.spacing(2),
    margin: theme.spacing(4),
    padding: theme.spacing(4),
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
  },
  hint: { ...theme.typography.body, color: theme.colors.text, textAlign: "center" },
  rejected: {
    ...theme.typography.body,
    color: theme.colors.danger,
    fontWeight: "700",
    textAlign: "center",
  },
})
