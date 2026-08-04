import { View } from "react-native"

import { useTheme } from "../theme-context"

type Props = {
  size?: number
  color?: string
}

/**
 * A decorative right-pointing "play" triangle drawn with borders — needs no
 * icon font or emoji, so it renders identically everywhere and stays out of
 * the accessibility tree. Used as the neutral fallback inside a video
 * thumbnail that has no poster image (replacing the old "HLS" tech jargon).
 *
 * The default colour follows the active theme; it used to come from the static
 * default one, which left a light-grey glyph on every dark theme's thumbnails.
 */
export function PlayGlyph({ size = 16, color }: Props) {
  const theme = useTheme()
  return (
    <View
      accessible={false}
      style={{
        width: 0,
        height: 0,
        borderTopWidth: size * 0.6,
        borderBottomWidth: size * 0.6,
        borderLeftWidth: size,
        borderTopColor: "transparent",
        borderBottomColor: "transparent",
        borderLeftColor: color ?? theme.colors.mutedFaint,
      }}
    />
  )
}
