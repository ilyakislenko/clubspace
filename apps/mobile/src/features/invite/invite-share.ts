export const inviteShareMessage = ({
  workspaceName,
  joinUrl,
  joinCodeDisplay,
}: {
  workspaceName: string
  joinUrl: string
  joinCodeDisplay: string
}): string =>
  `Присоединяйтесь к клубу «${workspaceName}» в ClubSpace: ${joinUrl}\nКод клуба: ${joinCodeDisplay}`
