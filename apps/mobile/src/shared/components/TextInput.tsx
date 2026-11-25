import React, { forwardRef } from "react"
import {
  Platform,
  StyleSheet,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextStyle,
  type TextInputInstance,
} from "react-native"

import { isWeb } from "../platform"
import { useTheme } from "../theme-context"

/**
 * The app's TextInput. Import this instead of `react-native`'s — an eslint rule
 * enforces it (see eslint.config.mjs).
 *
 * On native it is React Native's TextInput with an explicit `letterSpacing: 0`
 * underneath the caller's style: iOS recycles native input views, and a
 * recycled view keeps the previous field's spacing — after sign-in (the
 * 8pt-spaced code field) the courses search placeholder read «П о и с к».
 * On web it guarantees a
 * 16px minimum font size, because **iOS Safari zooms the whole page in when you
 * focus an input smaller than that** — and it does not zoom back out when you
 * leave the field, so the member is left pinching their way back to a usable
 * layout. Six of this app's inputs (search boxes, the journal entry, session
 * notes, video notes and bookmark labels) were 13–15px and did exactly that.
 * The caret, selection and Android's selection handles take the brand
 * accent; left alone, Android paints them the native theme's teal and iOS
 * its system blue. Android's highlight sits behind the text, so it gets the
 * soft tint.
 */
export type AppTextInputProps = TextInputProps

// The iOS Safari threshold. At or above it, focusing an input doesn't zoom.
const MIN_WEB_FONT_SIZE = 16

export const TextInput = forwardRef<TextInputInstance, AppTextInputProps>(
  function AppTextInput({ style, ...rest }, ref) {
    const theme = useTheme()
    if (!isWeb) {
      return (
        <RNTextInput
          ref={ref}
          style={[styles.native, style]}
          cursorColor={theme.colors.accent}
          selectionHandleColor={theme.colors.accent}
          selectionColor={
            Platform.OS === "android" ? theme.colors.accentSoft : theme.colors.accent
          }
          {...rest}
        />
      )
    }

    // Only raise a size that's too small — a deliberately large field (the
    // 24px check-in code) has to keep its own scale.
    const flat = StyleSheet.flatten(style) as TextStyle | undefined
    const size = flat?.fontSize
    const needsBump = typeof size !== "number" || size < MIN_WEB_FONT_SIZE

    return (
      <RNTextInput
        ref={ref}
        style={needsBump ? [style, styles.minFont] : style}
        {...rest}
      />
    )
  },
)

const styles = StyleSheet.create({
  native: { letterSpacing: 0 },
  minFont: { fontSize: MIN_WEB_FONT_SIZE },
})
