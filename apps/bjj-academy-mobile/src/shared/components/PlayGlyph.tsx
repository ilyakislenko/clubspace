import { View } from "react-native"

import { theme } from "../theme"

type Props = {
  size?: number
  color?: string
}

/**
 * A decorative right-pointing "play" triangle drawn with borders — needs no
 * icon font or emoji, so it renders identically everywhere and stays out of
 * the accessibility tree. Used as the neutral fallback inside a video
 * thumbnail that has no poster image (replacing the old "HLS" tech jargon).
 */
export function PlayGlyph({
  size = 16,
  color = theme.colors.mutedFaint,
}: Props) {
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
        borderLeftColor: color,
      }}
    />
  )
}
