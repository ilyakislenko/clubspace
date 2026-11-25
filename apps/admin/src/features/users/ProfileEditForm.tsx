"use client"

import { useState, type FormEvent } from "react"

import { Button, Input, Label } from "@clubspace/ui-kit/ui"
import { useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { todayYmd } from "./birth-date"

const L = FORM_LIMITS.profile

type Props = {
  // phone is optional: the self-edit card doesn't show it, the staff view does.
  // email is omitted for a child profile, which has no login e-mail.
  // dateOfBirth (YYYY-MM-DD, "" = none) only where the caller passes it: the
  // staff view of a member, not the own-profile dialog.
  initial: {
    firstname: string
    lastname: string
    email?: string
    phone?: string
    dateOfBirth?: string
  }
  submitting: boolean
  onCancel: () => void
  onSubmit: (patch: {
    firstname: string | null
    lastname: string | null
    email?: string
    phone?: string | null
    dateOfBirth?: string | null
  }) => Promise<void>
}

export function ProfileEditForm({
  initial,
  submitting,
  onCancel,
  onSubmit,
}: Props) {
  const vocabulary = useVocabulary()
  const [firstname, setFirstname] = useState(initial.firstname)
  const [lastname, setLastname] = useState(initial.lastname)
  const [email, setEmail] = useState(initial.email ?? "")
  const [phone, setPhone] = useState(initial.phone ?? "")
  const [dateOfBirth, setDateOfBirth] = useState(initial.dateOfBirth ?? "")
  const dateChanged =
    initial.dateOfBirth !== undefined && dateOfBirth !== initial.dateOfBirth

  const dirty =
    firstname.trim() !== initial.firstname ||
    lastname.trim() !== initial.lastname ||
    (initial.email !== undefined &&
      email.trim().toLowerCase() !== initial.email.toLowerCase()) ||
    (initial.phone !== undefined && phone.trim() !== initial.phone) ||
    dateChanged
  useDirtyGuard(dirty)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!dirty || submitting) return
    void onSubmit({
      firstname: firstname.trim() || null,
      lastname: lastname.trim() || null,
      ...(initial.email !== undefined
        ? { email: email.trim().toLowerCase() }
        : {}),
      ...(initial.phone !== undefined ? { phone: phone.trim() || null } : {}),
      // Only a change: the edit's audit entry names what was set.
      ...(dateChanged ? { dateOfBirth: dateOfBirth || null } : {}),
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="profile-first">Имя</Label>
          <Input
            id="profile-first"
            maxLength={L.firstname.max}
            value={firstname}
            onChange={(e) => setFirstname(e.target.value)}
            placeholder="Иван"
          />
        </div>
        <div>
          <Label htmlFor="profile-last">Фамилия</Label>
          <Input
            id="profile-last"
            maxLength={L.lastname.max}
            value={lastname}
            onChange={(e) => setLastname(e.target.value)}
            placeholder="Иванов"
          />
        </div>
      </div>
      {initial.email !== undefined && (
        <div>
          <Label htmlFor="profile-email">Email</Label>
          <Input
            id="profile-email"
            maxLength={L.email.max}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ivan@mail.ru"
            required
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Если ученик меняет почту — обнови её здесь. Коды для входа будут
            уходить на новый адрес, старые токены остаются валидными.
          </p>
        </div>
      )}
      {initial.phone !== undefined && (
        <div>
          <Label htmlFor="profile-phone">Телефон</Label>
          <Input
            id="profile-phone"
            maxLength={L.phone.max}
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+7 900 000-00-00"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            По нему {vocabulary.coach.nom} звонит из списка «Удержание» → «Позвонить».
          </p>
        </div>
      )}
      {initial.dateOfBirth !== undefined && (
        <div>
          <Label htmlFor="profile-dob">Дата рождения</Label>
          <Input
            id="profile-dob"
            type="date"
            min="1900-01-01"
            max={todayYmd(new Date())}
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            className="w-48"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Видят только сотрудники клуба.
          </p>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={submitting}
        >
          Отмена
        </Button>
        <Button type="submit" disabled={!dirty || submitting}>
          {submitting ? "Сохраняю…" : "Сохранить"}
        </Button>
      </div>
    </form>
  )
}
