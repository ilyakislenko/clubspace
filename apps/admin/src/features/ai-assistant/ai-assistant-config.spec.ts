import {
  claudeCodeCommand,
  claudeDesktopConfig,
  cursorConfig,
  expiryLabel,
} from "./ai-assistant-config"

const URL = "https://api.example.ru/mcp"
const TOKEN = "csai_secret"

describe("ИИ-ассистент connection snippets", () => {
  it("Claude Code: remote HTTP server with the bearer header", () => {
    expect(claudeCodeCommand(URL, TOKEN)).toBe(
      'claude mcp add --transport http clubspace https://api.example.ru/mcp --header "Authorization: Bearer csai_secret"',
    )
  })

  it("Claude Desktop: mcp-remote with the header taken from env", () => {
    const config = JSON.parse(claudeDesktopConfig(URL, TOKEN))
    expect(config.mcpServers.clubspace).toEqual({
      command: "npx",
      args: ["-y", "mcp-remote", URL, "--header", "Authorization:${CLUBSPACE_TOKEN}"],
      env: { CLUBSPACE_TOKEN: "Bearer csai_secret" },
    })
  })

  it("Cursor: url plus headers", () => {
    expect(JSON.parse(cursorConfig(URL, TOKEN))).toEqual({
      mcpServers: { clubspace: { url: URL, headers: { Authorization: "Bearer csai_secret" } } },
    })
  })

  it("labels lifetimes", () => {
    expect(expiryLabel(90)).toBe("90 дней")
    expect(expiryLabel(null)).toBe("Бессрочно")
  })
})
