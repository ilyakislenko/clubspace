// Connection snippets for the ИИ-ассистент card (docs/mcp.md has the long
// version). The token is pasted once, right after it was created.

export const AI_DATA_MODE_LABEL: Record<"PSEUDONYMIZED" | "PERSONAL", string> = {
  PSEUDONYMIZED: "Обезличено",
  PERSONAL: "С персональными данными",
}

// The assistant's tools by their server name (`features/mcp/tools`, `title`),
// for the audit log. `coach_stats` is named in the club's words by the caller.
export const AI_TOOL_LABEL: Record<string, string> = {
  club_directory: "Справочник клуба",
  club_overview: "Сводка по клубу",
  search_members: "Поиск участников",
  member_profile: "Карточка участника",
  at_risk_members: "Кто может уйти",
  revenue_report: "Выручка",
  renewals_due: "Кому продлевать",
  unpaid_abonements: "Долги: неоплаченные абонементы",
  abonement_states: "Состояние абонементов",
  rank_distribution: "Ранги учеников",
  upcoming_gradings: "Аттестации",
  schedule: "Расписание",
  attendance_stats: "Посещаемость",
  schedule_occupancy: "Загрузка расписания",
  list_events: "События",
}

export const AI_TOKEN_STATE_LABEL: Record<"active" | "expired" | "revoked", string> = {
  active: "Действует",
  expired: "Истёк",
  revoked: "Отозван",
}

export const expiryLabel = (days: number | null): string =>
  days === null ? "Бессрочно" : `${days} дней`

// Claude Code: one command, remote HTTP server with the header.
export const claudeCodeCommand = (mcpUrl: string, secret: string): string =>
  `claude mcp add --transport http clubspace ${mcpUrl} --header "Authorization: Bearer ${secret}"`

// Claude Desktop (and any stdio-only client): the mcp-remote bridge.
export const claudeDesktopConfig = (mcpUrl: string, secret: string): string =>
  JSON.stringify(
    {
      mcpServers: {
        clubspace: {
          command: "npx",
          args: ["-y", "mcp-remote", mcpUrl, "--header", "Authorization:${CLUBSPACE_TOKEN}"],
          env: { CLUBSPACE_TOKEN: `Bearer ${secret}` },
        },
      },
    },
    null,
    2,
  )

// Cursor: ~/.cursor/mcp.json, remote server with headers.
export const cursorConfig = (mcpUrl: string, secret: string): string =>
  JSON.stringify(
    {
      mcpServers: {
        clubspace: { url: mcpUrl, headers: { Authorization: `Bearer ${secret}` } },
      },
    },
    null,
    2,
  )
