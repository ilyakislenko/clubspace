import React from "react"
import { Text } from "react-native"

const escapeRegex = (input: string) =>
  input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

type Props = {
  text: string
  query: string
  style?: React.ComponentProps<typeof Text>["style"]
  highlightStyle?: React.ComponentProps<typeof Text>["style"]
  numberOfLines?: number
}

// Renders `text` with case-insensitive matches of `query` wrapped in
// `highlightStyle`. Empty query renders the text unchanged.
export const HighlightedText = ({
  text,
  query,
  style,
  highlightStyle,
  numberOfLines,
}: Props) => {
  const trimmed = query.trim()
  if (trimmed.length === 0) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {text}
      </Text>
    )
  }
  const re = new RegExp(`(${escapeRegex(trimmed)})`, "ig")
  const parts = text.split(re)
  const lowerQuery = trimmed.toLowerCase()
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, idx) =>
        part.toLowerCase() === lowerQuery ? (
          <Text key={idx} style={highlightStyle}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  )
}
