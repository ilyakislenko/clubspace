// Russian display labels for the backend's MemberStatus values, so no screen
// shows the raw enum (e.g. "ACTIVE"). Unknown statuses fall back to the raw value.

const MEMBER_STATUS_LABEL_RU: Record<string, string> = {
  ACTIVE: "Активен",
  INVITED: "Ожидает одобрения",
  SUSPENDED: "Приостановлен",
  BLOCKED: "Заблокирован",
}

export const memberStatusLabel = (status: string): string =>
  MEMBER_STATUS_LABEL_RU[status] ?? status
