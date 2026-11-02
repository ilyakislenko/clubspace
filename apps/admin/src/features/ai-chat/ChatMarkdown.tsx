'use client';

import { Fragment, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { Ticket, User, UserCog, Users } from 'lucide-react';

import type { AiChatEntity } from '../../shared/api/ai-chat';
import { type Inline, parseMarkdown } from './chat-markdown';

// Where a chip leads in the admin.
export const entityHref = (workspaceId: string, e: AiChatEntity): string => {
  const base = `/workspace/${workspaceId}`;
  if (e.type === 'group') return `${base}/groups/${e.id}`;
  if (e.type === 'plan') return `${base}/subscriptions/plans/${e.id}`;
  return `${base}/users/${e.id}`;
};

const ICON = {
  member: User,
  staff: UserCog,
  group: Users,
  plan: Ticket,
} as const;

// What an unresolved token reads as: out of the asker's scope now, or the
// name hasn't arrived yet mid-stream.
const unresolvedLabel = (token: string): string => {
  if (token.startsWith('m_')) return 'участник';
  if (token.startsWith('c_')) return 'тренер';
  if (token.startsWith('[group:')) return 'группа';
  return 'тариф';
};

export function EntityChip({
  token,
  entity,
  workspaceId,
}: {
  token: string;
  entity: AiChatEntity | undefined;
  workspaceId: string;
}) {
  if (!entity) {
    return (
      <span
        className="mx-0.5 inline-flex items-center rounded-full bg-muted px-2 py-0.5 align-baseline text-xs text-muted-foreground"
        title="Нет доступа или ещё загружается"
      >
        {unresolvedLabel(token)}
      </span>
    );
  }
  const Icon = ICON[entity.type];
  return (
    <Link
      href={entityHref(workspaceId, entity)}
      className="mx-0.5 inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 align-baseline text-xs font-medium text-primary hover:bg-primary/20"
    >
      <Icon className="size-3" />
      {entity.label}
    </Link>
  );
}

export function ChatMarkdown({
  text,
  entities,
  workspaceId,
}: {
  text: string;
  entities: ReadonlyMap<string, AiChatEntity>;
  workspaceId: string;
}) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);

  const inline = (nodes: Inline[]): ReactNode =>
    nodes.map((n, i) => {
      switch (n.kind) {
        case 'text':
          return <Fragment key={i}>{n.text}</Fragment>;
        case 'bold':
          return <strong key={i}>{inline(n.children)}</strong>;
        case 'italic':
          return <em key={i}>{inline(n.children)}</em>;
        case 'code':
          return (
            <code
              key={i}
              className="rounded bg-muted px-1 py-0.5 text-[0.85em]"
            >
              {n.text}
            </code>
          );
        case 'entity':
          return (
            <EntityChip
              key={i}
              token={n.token}
              entity={entities.get(n.token)}
              workspaceId={workspaceId}
            />
          );
      }
    });

  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h':
            return (
              <div
                key={i}
                className={
                  b.level === 1 ? 'text-base font-semibold' : 'font-semibold'
                }
              >
                {inline(b.inline)}
              </div>
            );
          case 'p':
            return (
              <p key={i}>
                {b.lines.map((line, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {inline(line)}
                  </Fragment>
                ))}
              </p>
            );
          case 'ul':
            return (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {b.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol
                key={i}
                start={b.start}
                className="list-decimal space-y-1 pl-5"
              >
                {b.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </ol>
            );
          case 'table':
            return (
              <div
                key={i}
                className="overflow-x-auto rounded-md border border-border"
              >
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {b.head.map((cell, j) => (
                        <th key={j} className="px-3 py-2 font-medium">
                          {inline(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, j) => (
                      <tr key={j} className="border-t border-border">
                        {row.map((cell, k) => (
                          <td key={k} className="px-3 py-2">
                            {inline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'code':
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-md bg-muted p-3 text-xs"
              >
                {b.text}
              </pre>
            );
        }
      })}
    </div>
  );
}
