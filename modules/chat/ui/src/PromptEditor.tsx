import {
  ChatService,
  type Conversation,
  type PromptTemplate,
  type PromptTemplates,
} from "@knowcel/chat-api/knowcel/chat/v1/chat_pb";
import {
  ConnectError,
  toast,
  useClient,
  useIsPlatformAdmin,
  useQuery,
  useQueryClient,
} from "@knowcel/module-sdk";
import { Button, Dialog, ErrorMessage, fieldError, Spinner, Textarea } from "@knowcel/ui";
import { MessageSquareText } from "lucide-react";
import { useId, useState } from "react";

const TEMPLATES_KEY = ["prompt-templates"];

/** The admin-editable templates: request field, label and what each is for. */
const GLOBAL_FIELDS = [
  {
    field: "systemPrompt",
    violation: "system_prompt",
    label: "Default system prompt",
    hint: "Used by conversations without their own prompt.",
  },
  {
    field: "sourcesTemplate",
    violation: "sources_template",
    label: "Sources template",
    hint: "Added when sources were found and the prompt doesn't place {sources} itself. Must contain {sources}.",
  },
  {
    field: "noSourcesTemplate",
    violation: "no_sources_template",
    label: "No-sources template",
    hint: "Added when nothing in the knowledge base is related to the question.",
  },
] as const;

type GlobalField = (typeof GLOBAL_FIELDS)[number]["field"];
type Drafts = Record<GlobalField, string>;

const VARIABLE_HELP = [
  ["{sources}", "the numbered passages the answer is grounded in"],
  ["{history}", "the earlier messages of the conversation"],
] as const;

function Variables() {
  return (
    <p className="text-xs text-fg-muted">
      Variables you can use:{" "}
      {VARIABLE_HELP.map(([name, what], i) => (
        <span key={name}>
          {i > 0 && "; "}
          <code>{name}</code> ({what})
        </span>
      ))}
      . Write <code>{"{{"}</code> and <code>{"}}"}</code> for literal braces. A prompt with{" "}
      <code>{"{history}"}</code> shows the history itself.
    </p>
  );
}

/** A labelled template field with its inline error and a reset to `reset`. */
function TemplateField({
  label,
  hint,
  value,
  error,
  reset,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  error?: string;
  reset: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <p id={hintId} className="text-xs text-fg-muted">
        {hint}
      </p>
      <Textarea
        id={id}
        rows={5}
        value={value}
        aria-invalid={error !== undefined}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
      <div>
        <Button variant="ghost" className="-ml-3 text-xs" onClick={() => onChange(reset)}>
          Reset to default
        </Button>
      </div>
    </div>
  );
}

function drafts(t: PromptTemplates): Drafts {
  return {
    systemPrompt: t.systemPrompt?.content ?? "",
    sourcesTemplate: t.sourcesTemplate?.content ?? "",
    noSourcesTemplate: t.noSourcesTemplate?.content ?? "",
  };
}

function builtIn(t: PromptTemplates, field: GlobalField): string {
  const template: PromptTemplate | undefined = t[field];
  return template?.defaultContent ?? "";
}

/**
 * Edits the system prompt of a conversation from its header. Platform admins
 * also see the defaults for all conversations; for everyone else they are
 * hidden, as the server would refuse the change.
 */
export function PromptEditor({ conversation }: { conversation: Conversation }) {
  const client = useClient(ChatService);
  const queryClient = useQueryClient();
  const isAdmin = useIsPlatformAdmin();
  const [open, setOpen] = useState(false);
  // null while untouched: the conversation's prompt, else the default, is shown.
  const [prompt, setPrompt] = useState<string | null>(null);
  const [global, setGlobal] = useState<Drafts | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const templates = useQuery({
    queryKey: TEMPLATES_KEY,
    queryFn: () => client.getPromptTemplates({}),
    enabled: open,
  });
  const current = templates.data?.templates;
  // The prompt in use: the conversation's own, else the default.
  const effective = current?.systemPrompt?.content ?? "";

  const show = () => {
    setErrors({});
    setFailure(null);
    setPrompt(null);
    setGlobal(null);
    setOpen(true);
  };
  const close = () => setOpen(false);

  const shownPrompt = prompt ?? (conversation.systemPrompt || effective);
  const shownGlobal = global ?? (current ? drafts(current) : null);

  const save = async () => {
    if (!current) return;
    setSaving(true);
    setErrors({});
    setFailure(null);
    let step: "prompt" | "global" = "prompt";
    try {
      // The same as the default means "follow the default", also when it changes.
      const own = shownPrompt.trim() === effective.trim() ? "" : shownPrompt;
      if (own !== conversation.systemPrompt) {
        await client.updateConversation({ id: conversation.id, systemPrompt: own });
      }
      if (isAdmin && global) {
        step = "global";
        const before = drafts(current);
        const changes = Object.fromEntries(
          GLOBAL_FIELDS.filter(({ field }) => global[field] !== before[field]).map(({ field }) => [
            field,
            // Equal to the built-in text means reset.
            global[field].trim() === builtIn(current, field).trim() ? "" : global[field],
          ]),
        );
        if (Object.keys(changes).length > 0) await client.updatePromptTemplates(changes);
      }
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      await queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
      toast.success("Prompt saved");
      close();
    } catch (err) {
      const e: Record<string, string> = {};
      if (step === "prompt") {
        const message = fieldError(err, "system_prompt");
        if (message) e.prompt = message;
      } else {
        for (const { violation } of GLOBAL_FIELDS) {
          const message = fieldError(err, violation);
          if (message) e[`global.${violation}`] = message;
        }
      }
      setErrors(e);
      if (Object.keys(e).length === 0) setFailure(readable(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="ghost" onClick={show}>
        <MessageSquareText className="size-4" aria-hidden="true" />
        Prompt
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Prompt for this conversation"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !current}>
              Save
            </Button>
          </>
        }
      >
        {templates.isPending && <Spinner />}
        <ErrorMessage
          error={templates.error ? "The prompt couldn't be loaded. Try again later." : null}
        />
        {failure && <ErrorMessage error={failure} />}
        {current && shownGlobal && (
          <div className="flex flex-col gap-5">
            <Variables />
            <TemplateField
              label="System prompt"
              hint="Instructions to the model for the answers in this conversation. It applies to the questions you ask next."
              value={shownPrompt}
              error={errors.prompt}
              reset={effective}
              onChange={setPrompt}
            />
            {isAdmin && (
              <fieldset className="flex flex-col gap-4 border-t border-border pt-4">
                <legend className="font-medium">Defaults for all conversations</legend>
                <p className="text-xs text-fg-muted">
                  Only platform admins can change these. They apply to every conversation without
                  its own prompt.
                </p>
                {GLOBAL_FIELDS.map(({ field, violation, label, hint }) => (
                  <TemplateField
                    key={field}
                    label={label}
                    hint={hint}
                    value={shownGlobal[field]}
                    error={errors[`global.${violation}`]}
                    reset={builtIn(current, field)}
                    onChange={(v) => setGlobal({ ...shownGlobal, [field]: v })}
                  />
                ))}
              </fieldset>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

function readable(err: unknown): string {
  return ConnectError.from(err).rawMessage || "Something went wrong. Try again.";
}
