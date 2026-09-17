// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license.
import { useState } from "react";
import { useBeforeUnload, useBlocker } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@cloudflare/kumo";
import { useMailboxes } from "~/queries/mailboxes";
import { ApiError } from "~/services/api";
import type {
  AutomationAction,
  AutomationMatchField,
} from "shared/automations";
import { FOLDER_DISPLAY_NAMES, SYSTEM_FOLDER_IDS } from "shared/folders";

type Group = {
  id: string;
  name: string;
  parentId: string | null;
  mailboxIds: string[];
};
type Memory = {
  scopeType: "all" | "group" | "mailbox";
  scopeId: string;
  content: string;
  revision: number;
};
type Rule = {
  id: string;
  name: string;
  scopeType: "all" | "group" | "mailboxes";
  scopeIds: string[];
  matchField: AutomationMatchField;
  matchValue: string;
  actions: AutomationAction[];
  enabled: boolean;
};
type Choice = { id: string; name: string };
const panel = "rounded-2xl border border-white/10 bg-[#111111] p-5 space-y-4";
const input =
  "w-full rounded-lg border border-white/15 bg-[#0c0c0c] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/40 disabled:opacity-50";
const hint = "text-xs text-white/60 leading-relaxed";
const rootKey = ["hierarchy-settings"] as const;
const memoryLimit = 4000;

async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/v1/settings${path}`, {
    method,
    credentials: "same-origin",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000),
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw new ApiError(
      response.status,
      (await response.json().catch(() => ({}))) as Record<string, unknown>,
    );
  return response.status === 204 ? (undefined as T) : response.json();
}
function Feedback({
  error,
  saved,
  pending,
}: {
  error?: Error | null;
  saved?: boolean;
  pending?: boolean;
}) {
  return (
    <>
      {error && (
        <p
          role="alert"
          className="text-sm border border-white/30 rounded-lg p-3"
        >
          {error instanceof ApiError &&
          error.status === 409 &&
          error.body.memory
            ? "Conflict: settings changed elsewhere. Your edits have been kept. Reload the latest version before saving again. "
            : ""}
          {error.message}
        </p>
      )}
      <p role="status" className={hint}>
        {pending ? "Saving…" : saved ? "Saved." : ""}
      </p>
    </>
  );
}
function Choices({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Choice[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm mb-2">{label}</legend>
      <div className="max-h-48 overflow-auto rounded-lg border border-white/10 p-3 space-y-2">
        {options.length === 0 && <p className={hint}>None available.</p>}
        {options.map((item) => (
          <label
            key={item.id}
            className="flex items-center gap-2 text-sm break-all"
          >
            <input
              type="checkbox"
              checked={value.includes(item.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, item.id]
                    : value.filter((id) => id !== item.id),
                )
              }
            />
            {item.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function groupPath(group: Group, groups: Group[]): string {
  const names = [group.name];
  const seen = new Set([group.id]);
  let parent = groups.find((g) => g.id === group.parentId);
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    names.unshift(parent.name);
    parent = groups.find((g) => g.id === parent!.parentId);
  }
  return names.join(" / ");
}
export default function HierarchySettings({
  section,
  mailboxId,
}: {
  section: "groups" | "memory" | "automations";
  mailboxId?: string;
}) {
  const groups = useQuery({
    queryKey: [...rootKey, "groups"],
    queryFn: ({ signal }) =>
      request<{ groups: Group[] }>("/groups", "GET", undefined, signal),
  });
  const mailboxes = useMailboxes();
  if (groups.isPending || mailboxes.isPending)
    return <p role="status">Loading workspace settings…</p>;
  if (groups.error || mailboxes.error)
    return (
      <div className={panel}>
        <Feedback error={groups.error || mailboxes.error} />
        <Button
          onClick={() => {
            void groups.refetch();
            void mailboxes.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  const items = (mailboxes.data ?? [])
    .filter((m) => m.id !== "all")
    .map((m) => ({
      id: m.id,
      name: m.name ? `${m.name} (${m.email})` : m.email,
    }));
  const allGroups = groups.data?.groups ?? [];
  return (
    <div className="space-y-6 text-white/90">
      {section === "groups" && (
        <GroupsEditor groups={allGroups} mailboxes={items} />
      )}
      {section === "memory" && (
        <MemorySettings
          groups={allGroups}
          mailboxes={items}
          mailboxId={mailboxId}
        />
      )}
      {section === "automations" && (
        <SharedRules groups={allGroups} mailboxes={items} />
      )}
    </div>
  );
}

function GroupsEditor({
  groups,
  mailboxes,
}: {
  groups: Group[];
  mailboxes: Choice[];
}) {
  const qc = useQueryClient();
  const empty = { id: "", name: "", parentId: null, mailboxIds: [] } as Group;
  const [draft, setDraft] = useState<Group>(empty);
  const mutation = useMutation({
    mutationFn: ({ group, remove }: { group: Group; remove?: boolean }) =>
      request(
        `/groups${group.id ? `/${encodeURIComponent(group.id)}` : ""}`,
        remove ? "DELETE" : group.id ? "PUT" : "POST",
        remove
          ? undefined
          : {
              name: group.name.trim(),
              parentId: group.parentId,
              mailboxIds: group.mailboxIds,
            },
      ),
    onSuccess: async () => {
      setDraft(empty);
      await qc.invalidateQueries({ queryKey: rootKey });
    },
  });
  const descendants = new Set(draft.id ? [draft.id] : []);
  for (let i = 0; i < groups.length; i++)
    for (const group of groups)
      if (group.parentId && descendants.has(group.parentId))
        descendants.add(group.id);
  return (
    <>
      <div>
        <h2 className="text-lg font-semibold">Mailbox groups</h2>
        <p className={hint}>
          Nest groups under parents. A mailbox can belong to multiple groups and
          inherits settings from their ancestors.
        </p>
      </div>
      <div className={panel}>
        {groups.length === 0 && (
          <p className={hint}>No groups yet. Create one below.</p>
        )}
        {[...groups]
          .sort((a, b) =>
            groupPath(a, groups).localeCompare(groupPath(b, groups)),
          )
          .map((group) => (
            <div
              key={group.id}
              className="flex flex-wrap justify-between items-center gap-3 border-b border-white/10 pb-3"
            >
              <div className="min-w-0">
                <p className="text-sm break-words">
                  {groupPath(group, groups)}
                </p>
                <p className={hint}>
                  {group.mailboxIds.length} direct mailbox memberships
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={mutation.isPending}
                  onClick={() => {
                    setDraft({ ...group, mailboxIds: [...group.mailboxIds] });
                    mutation.reset();
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete group “${group.name}”? Mailboxes will not be deleted. Its own memory and memberships will be removed. First remove child groups and any shared rules that reference this group.`,
                      )
                    )
                      mutation.mutate({ group, remove: true });
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
      </div>
      <form
        className={panel}
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate({ group: draft });
        }}
      >
        <h3 className="font-medium">{draft.id ? "Edit group" : "New group"}</h3>
        <fieldset disabled={mutation.isPending} className="space-y-4">
          <label className="block text-sm">
            Name
            <input
              className={input}
              required
              maxLength={100}
              value={draft.name}
              onChange={(e) => {
                mutation.reset();
                setDraft({ ...draft, name: e.target.value });
              }}
            />
          </label>
          <label className="block text-sm">
            Parent group
            <select
              className={input}
              value={draft.parentId ?? ""}
              onChange={(e) => {
                mutation.reset();
                setDraft({ ...draft, parentId: e.target.value || null });
              }}
            >
              <option value="">No parent (top level)</option>
              {groups
                .filter((g) => !descendants.has(g.id))
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {groupPath(g, groups)}
                  </option>
                ))}
            </select>
          </label>
          <Choices
            label="Direct mailbox memberships"
            options={mailboxes}
            value={draft.mailboxIds}
            onChange={(mailboxIds) => {
              mutation.reset();
              setDraft({ ...draft, mailboxIds });
            }}
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={!draft.name.trim()}
            >
              Save group
            </Button>
            {draft.id && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setDraft(empty);
                  mutation.reset();
                }}
              >
                Cancel edit
              </Button>
            )}
          </div>
        </fieldset>
        <Feedback
          error={mutation.error}
          saved={mutation.isSuccess}
          pending={mutation.isPending}
        />
      </form>
    </>
  );
}

function MemorySettings({
  groups,
  mailboxes,
  mailboxId,
}: {
  groups: Group[];
  mailboxes: Choice[];
  mailboxId?: string;
}) {
  const [scope, setScope] = useState<{ type: Memory["scopeType"]; id: string }>(
    mailboxId && mailboxes.some((m) => m.id === mailboxId)
      ? { type: "mailbox", id: mailboxId }
      : { type: "all", id: "all" },
  );
  const [previewId, setPreviewId] = useState(
    mailboxes.some((m) => m.id === mailboxId) ? mailboxId! : "",
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useBeforeUnload((event) => {
    if (dirty || saving) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  useBlocker(({ currentLocation, nextLocation }) =>
    currentLocation.pathname !== nextLocation.pathname &&
    (saving || (dirty && !window.confirm("Discard unsaved memory edits?"))),
  );
  const choices =
    scope.type === "group"
      ? groups.map((g) => ({ id: g.id, name: groupPath(g, groups) }))
      : mailboxes;
  const changeScope = (next: typeof scope) => {
    if (dirty && !window.confirm("Discard unsaved memory edits?")) return;
    setDirty(false);
    setScope(next);
  };
  return (
    <>
      <div>
        <h2 className="text-lg font-semibold">Owner memory</h2>
        <p className={hint}>
          Only the owner can write memory here. Incoming emails cannot write or
          change it. Memory is not secret storage: do not include passwords,
          keys, or sensitive credentials. AI can still make mistakes; no perfect
          compliance or safety guarantee is possible.
        </p>
      </div>
      <div className={panel}>
        <fieldset disabled={saving} className="grid sm:grid-cols-2 gap-4">
          <label className="text-sm">
            Scope
            <select
              className={input}
              value={scope.type}
              onChange={(e) =>
                changeScope({
                  type: e.target.value as Memory["scopeType"],
                  id: e.target.value === "all" ? "all" : "",
                })
              }
            >
              <option value="all">Workspace (all mailboxes)</option>
              <option value="group">Group</option>
              <option value="mailbox">Mailbox</option>
            </select>
          </label>
          {scope.type !== "all" && (
            <label className="text-sm">
              {scope.type === "group" ? "Group" : "Mailbox"}
              <select
                className={input}
                value={scope.id}
                onChange={(e) => changeScope({ ...scope, id: e.target.value })}
              >
                <option value="">Select {scope.type}</option>
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>
        {scope.id && (
          <MemoryEditor
            key={`${scope.type}:${scope.id}`}
            scopeType={scope.type}
            scopeId={scope.id}
            onDirty={setDirty}
            onSaving={setSaving}
          />
        )}
      </div>
      <div className={panel}>
        <h3 className="font-medium">Effective inherited memory</h3>
        <p className={hint}>
          Saved workspace memory, ancestor groups, deeper groups, then mailbox
          memory. This preview does not include unsaved edits.
        </p>
        <label className="block text-sm">
          Preview mailbox
          <select
            className={input}
            value={previewId}
            onChange={(e) => setPreviewId(e.target.value)}
          >
            <option value="">Select a mailbox</option>
            {mailboxes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        {previewId && <EffectiveMemory mailboxId={previewId} groups={groups} />}
      </div>
    </>
  );
}
function MemoryEditor({
  scopeType,
  scopeId,
  onDirty,
  onSaving,
}: Pick<Memory, "scopeType" | "scopeId"> & {
  onDirty: (dirty: boolean) => void;
  onSaving: (saving: boolean) => void;
}) {
  const qc = useQueryClient();
  const key = [...rootKey, "memory", scopeType, scopeId];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      request<Memory>(
        `/memory?${new URLSearchParams({ scopeType, scopeId })}`,
        "GET",
        undefined,
        signal,
      ),
  });
  const [draft, setDraft] = useState<Memory | null>(null);
  const [reloading, setReloading] = useState(false);
  const mutation = useMutation({
    mutationFn: (memory: Memory) => request<Memory>("/memory", "PUT", memory),
    onMutate: () => onSaving(true),
    onSuccess: (memory) => {
      qc.setQueryData(key, memory);
      setDraft(null);
      onDirty(false);
      void qc.invalidateQueries({ queryKey: [...rootKey, "effective"] });
    },
    onSettled: () => onSaving(false),
  });
  const current = draft ?? query.data;
  const conflict =
    mutation.error instanceof ApiError && mutation.error.status === 409;
  return (
    <div className="space-y-3">
      {query.isPending && <p role="status">Loading memory…</p>}
      {query.error && (
        <>
          <Feedback error={query.error} />
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </>
      )}
      {current && (
        <>
          <label className="block text-sm">
            Memory content
            <textarea
              className={`${input} mt-2 font-mono`}
              rows={10}
              maxLength={memoryLimit}
              disabled={mutation.isPending || reloading}
              value={current.content}
              onChange={(e) => {
                if (!conflict) mutation.reset();
                setDraft({ ...current, content: e.target.value });
                onDirty(true);
              }}
            />
          </label>
          <p className={hint}>
            {current.content.length.toLocaleString()} /{" "}
            {memoryLimit.toLocaleString()} characters · Revision{" "}
            {current.revision}. Save empty content to clear this scope.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={
                mutation.isPending ||
                reloading ||
                !draft ||
                conflict ||
                current.content.length > memoryLimit
              }
              onClick={() => mutation.mutate(current)}
            >
              Save memory
            </Button>
            <Button
              variant="secondary"
              disabled={mutation.isPending || reloading || query.isFetching}
              onClick={async () => {
                if (
                  draft &&
                  !window.confirm(
                    "Discard your edits and load the latest saved memory? Copy your edits first if you need them.",
                  )
                )
                  return;
                // Reload replaces the draft; lock edits and scope navigation until it settles.
                setReloading(true);
                onSaving(true);
                try {
                  const result = await query.refetch();
                  if (result.isSuccess) {
                    setDraft(null);
                    onDirty(false);
                    mutation.reset();
                  }
                } finally {
                  setReloading(false);
                  onSaving(false);
                }
              }}
            >
              {reloading ? "Reloading…" : "Reload latest"}
            </Button>
          </div>
        </>
      )}
      <Feedback
        error={mutation.error}
        saved={mutation.isSuccess}
        pending={mutation.isPending}
      />
    </div>
  );
}
function EffectiveMemory({
  mailboxId,
  groups,
}: {
  mailboxId: string;
  groups: Group[];
}) {
  const query = useQuery({
    queryKey: [...rootKey, "effective", mailboxId],
    queryFn: ({ signal }) =>
      request<{ mailboxId: string; memories: Memory[]; prompt: string }>(
        `/effective-memory/${encodeURIComponent(mailboxId)}`,
        "GET",
        undefined,
        signal,
      ),
  });
  return (
    <div className="space-y-3">
      {query.isFetching && (
        <p role="status" className={hint}>
          Loading preview…
        </p>
      )}
      {query.error && (
        <>
          <Feedback error={query.error} />
          <Button onClick={() => void query.refetch()}>Retry preview</Button>
        </>
      )}
      {query.data && (
        <>
          <ol className={`${hint} list-decimal pl-5`}>
            {query.data.memories.map((m) => (
              <li key={`${m.scopeType}:${m.scopeId}`}>
                {m.scopeType === "all"
                  ? "Workspace"
                  : m.scopeType === "group"
                    ? `Group: ${groups.find((g) => g.id === m.scopeId)?.name ?? m.scopeId}`
                    : "Mailbox"}{" "}
                · revision {m.revision}
              </li>
            ))}
          </ol>
          <pre className="whitespace-pre-wrap break-words text-xs rounded-lg bg-black/30 p-4 max-h-96 overflow-auto">
            {query.data.prompt || "No saved memory applies to this mailbox."}
          </pre>
        </>
      )}
    </div>
  );
}
const actionLabels: Record<AutomationAction["type"], string> = {
  file: "File into folder",
  mark_read: "Mark as read",
  star: "Star",
  auto_reply: "Automatic reply",
  ai_reply: "AI reply",
};
function SharedRules({
  groups,
  mailboxes,
}: {
  groups: Group[];
  mailboxes: Choice[];
}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: [...rootKey, "automations"],
    queryFn: ({ signal }) =>
      request<{ automations: Rule[] }>(
        "/automations",
        "GET",
        undefined,
        signal,
      ),
  });
  const empty = (): Rule => ({
    id: "",
    name: "",
    scopeType: "all",
    scopeIds: [],
    matchField: "from",
    matchValue: "",
    actions: [],
    enabled: true,
  });
  const [draft, setDraft] = useState<Rule>(empty);
  const mutation = useMutation({
    mutationFn: ({ rule, remove }: { rule: Rule; remove?: boolean }) =>
      request(
        `/automations${rule.id ? `/${encodeURIComponent(rule.id)}` : ""}`,
        remove ? "DELETE" : rule.id ? "PUT" : "POST",
        remove
          ? undefined
          : {
              name: rule.name.trim(),
              scopeType: rule.scopeType,
              scopeIds: rule.scopeIds,
              matchField: rule.matchField,
              matchValue: rule.matchValue.trim(),
              actions: rule.actions,
              enabled: rule.enabled,
            },
      ),
    onSuccess: async (_data, variables) => {
      if (!variables.remove) setDraft(empty());
      else if (draft.id === variables.rule.id) setDraft(empty());
      await qc.invalidateQueries({ queryKey: rootKey });
    },
  });
  const change = (next: Rule) => {
    mutation.reset();
    setDraft(next);
  };
  const scopeOptions = groups.map((g) => ({
    id: g.id,
    name: groupPath(g, groups),
  }));
  const valid =
    draft.name.trim() &&
    draft.matchValue.trim() &&
    (draft.scopeType === "all" || draft.scopeIds.length > 0) &&
    draft.actions.length > 0 &&
    draft.actions.every((a) => a.type !== "auto_reply" || a.body.trim());
  return (
    <>
      <div>
        <h2 className="text-lg font-semibold">Shared automations</h2>
        <p className={hint}>
          Deterministic, case-insensitive contains matching. Selected mailbox
          rules (including Mailbox rules) take priority, then the deepest
          matching group, then workspace rules. The first enabled match wins.
          Ties use oldest creation time, then rule ID. Group rules include
          descendant memberships.
        </p>
      </div>
      <div className={panel}>
        {query.isPending && <p role="status">Loading shared rules…</p>}
        {query.error && (
          <>
            <Feedback error={query.error} />
            <Button onClick={() => void query.refetch()}>Retry</Button>
          </>
        )}
        {query.data?.automations.length === 0 && (
          <p className={hint}>No shared rules yet.</p>
        )}
        {query.data?.automations.map((rule) => (
          <div
            key={rule.id}
            className="border-b border-white/10 pb-3 space-y-2"
          >
            <div className="flex flex-wrap justify-between items-center gap-2">
              <h3 className="text-sm font-medium break-all">
                {rule.name} {!rule.enabled && "· Disabled"}
              </h3>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={mutation.isPending}
                  onClick={() =>
                    change({
                      ...rule,
                      scopeIds: [...rule.scopeIds],
                      actions: rule.actions.map((a) => ({ ...a })),
                    })
                  }
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete shared rule “${rule.name}”?`))
                      mutation.mutate({ rule, remove: true });
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
            <p className={hint}>
              {rule.scopeType === "all"
                ? "All mailboxes"
                : rule.scopeIds
                    .map(
                      (id) =>
                        (rule.scopeType === "group"
                          ? scopeOptions
                          : mailboxes
                        ).find((o) => o.id === id)?.name ?? id,
                    )
                    .join(", ")}{" "}
              · {rule.matchField} contains “{rule.matchValue}”
            </p>
            <p className={hint}>
              {rule.actions.map((a) => actionLabels[a.type]).join(" → ")}
            </p>
          </div>
        ))}
      </div>
      <form
        className={panel}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) mutation.mutate({ rule: draft });
        }}
      >
        <h3 className="font-medium">
          {draft.id ? "Edit shared rule" : "New shared rule"}
        </h3>
        <fieldset disabled={mutation.isPending} className="space-y-4">
          <label className="block text-sm">
            Rule name
            <input
              className={input}
              required
              maxLength={100}
              value={draft.name}
              onChange={(e) => change({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            Apply to
            <select
              className={input}
              value={draft.scopeType}
              onChange={(e) =>
                change({
                  ...draft,
                  scopeType: e.target.value as Rule["scopeType"],
                  scopeIds: [],
                })
              }
            >
              <option value="all">All mailboxes</option>
              <option value="group">One or more groups</option>
              <option value="mailboxes">Selected mailboxes</option>
            </select>
          </label>
          {draft.scopeType !== "all" && (
            <Choices
              label={draft.scopeType === "group" ? "Groups" : "Mailboxes"}
              options={draft.scopeType === "group" ? scopeOptions : mailboxes}
              value={draft.scopeIds}
              onChange={(scopeIds) => change({ ...draft, scopeIds })}
            />
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-sm">
              Match field
              <select
                className={input}
                value={draft.matchField}
                onChange={(e) =>
                  change({
                    ...draft,
                    matchField: e.target.value as AutomationMatchField,
                  })
                }
              >
                <option value="from">From</option>
                <option value="subject">Subject</option>
                <option value="to">To</option>
              </select>
            </label>
            <label className="text-sm">
              Contains
              <input
                className={input}
                required
                maxLength={200}
                value={draft.matchValue}
                onChange={(e) =>
                  change({ ...draft, matchValue: e.target.value })
                }
              />
            </label>
          </div>
          <ActionEditor
            actions={draft.actions}
            onChange={(actions) => change({ ...draft, actions })}
          />
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => change({ ...draft, enabled: e.target.checked })}
            />
            Enabled
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={!valid}>
              Save shared rule
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => change(empty())}
            >
              {draft.id ? "Cancel edit" : "Clear form"}
            </Button>
          </div>
        </fieldset>
        <Feedback
          error={mutation.error}
          saved={mutation.isSuccess}
          pending={mutation.isPending}
        />
      </form>
    </>
  );
}
function SystemFolder({
  label,
  value,
  onChange,
  optional = false,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  optional?: boolean;
}) {
  return (
    <label className="block text-sm">
      {label}
      <select
        className={input}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {optional && <option value="">Leave in current folder</option>}
        {SYSTEM_FOLDER_IDS.filter((id) => id !== "all_mail").map((id) => (
          <option key={id} value={id}>
            {FOLDER_DISPLAY_NAMES[id]}
          </option>
        ))}
      </select>
    </label>
  );
}
function ActionEditor({
  actions,
  onChange,
}: {
  actions: AutomationAction[];
  onChange: (actions: AutomationAction[]) => void;
}) {
  const replace = (index: number, action: AutomationAction) =>
    onChange(actions.map((a, i) => (i === index ? action : a)));
  const move = (index: number, offset: number) => {
    const next = [...actions];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  };
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium">Actions (in order)</h4>
      <p className={hint}>
        Shared rules use system folders only. At most 20 actions and one reply
        per rule. Automatic and AI replies send email without review; AI output
        may be incorrect.
      </p>
      {actions.map((action, i) => (
        <div
          key={i}
          className="rounded-lg border border-white/15 p-3 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              {i + 1}. {actionLabels[action.type]}
            </span>
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Move action ${i + 1} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ↑
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Move action ${i + 1} down`}
                disabled={i === actions.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onChange(actions.filter((_, n) => n !== i))}
              >
                Remove
              </Button>
            </div>
          </div>
          {action.type === "file" && (
            <SystemFolder
              label="Destination folder"
              value={action.folder}
              onChange={(folder) => replace(i, { ...action, folder })}
            />
          )}
          {(action.type === "auto_reply" || action.type === "ai_reply") && (
            <>
              <label className="block text-sm">
                {action.type === "auto_reply"
                  ? "Reply body"
                  : "AI instructions (optional)"}
                <textarea
                  className={input}
                  rows={4}
                  maxLength={action.type === "auto_reply" ? 5000 : 1000}
                  required={action.type === "auto_reply"}
                  value={
                    action.type === "auto_reply"
                      ? action.body
                      : (action.prompt ?? "")
                  }
                  onChange={(e) =>
                    replace(
                      i,
                      action.type === "auto_reply"
                        ? { ...action, body: e.target.value }
                        : { ...action, prompt: e.target.value },
                    )
                  }
                />
              </label>
              <div className="grid sm:grid-cols-2 gap-3">
                <SystemFolder
                  optional
                  label="On reply success"
                  value={action.onSuccessFolder}
                  onChange={(value) =>
                    replace(i, {
                      ...action,
                      onSuccessFolder: value || undefined,
                    })
                  }
                />
                <SystemFolder
                  optional
                  label="On reply failure"
                  value={action.onFailureFolder}
                  onChange={(value) =>
                    replace(i, {
                      ...action,
                      onFailureFolder: value || undefined,
                    })
                  }
                />
              </div>
            </>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(actionLabels) as AutomationAction["type"][]).map(
          (type) => (
            <Button
              key={type}
              type="button"
              variant="secondary"
              size="sm"
              disabled={
                actions.length >= 20 ||
                ((type === "auto_reply" || type === "ai_reply") &&
                  actions.some(
                    (a) => a.type === "auto_reply" || a.type === "ai_reply",
                  ))
              }
              onClick={() =>
                onChange([
                  ...actions,
                  type === "file"
                    ? { type, folder: "archive" }
                    : type === "auto_reply"
                      ? { type, body: "" }
                      : type === "ai_reply"
                        ? { type, prompt: "" }
                        : { type },
                ])
              }
            >
              + {actionLabels[type]}
            </Button>
          ),
        )}
      </div>
    </div>
  );
}
