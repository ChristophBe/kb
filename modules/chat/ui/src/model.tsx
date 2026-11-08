import { LlmService, ModelKind } from "@kb/llm-api/kb/llm/v1/llm_pb";
import { useClient, useQuery } from "@kb/module-sdk";
import { useState } from "react";

const STORAGE_PREFIX = "kb.chat.model.";

function readModel(conversationId: string): string | null {
  try {
    return localStorage.getItem(STORAGE_PREFIX + conversationId);
  } catch {
    return null;
  }
}

function storeModel(conversationId: string, model: string | null) {
  try {
    if (model === null) localStorage.removeItem(STORAGE_PREFIX + conversationId);
    else localStorage.setItem(STORAGE_PREFIX + conversationId, model);
  } catch {
    // Storage blocked: the choice lasts while the page is open.
  }
}

/** The chat models to choose from, the llm default first. */
function useChatModels() {
  const llm = useClient(LlmService);
  return useQuery({
    queryKey: ["chat", "models"],
    queryFn: async () => {
      const [{ models }, status] = await Promise.all([
        llm.listModels({}),
        llm.getProviderStatus({}),
      ]);
      const defaultModel = status.defaultChatModel;
      // Ollama lists the default "llama3.2" as "llama3.2:latest"; offer it once.
      const isDefault = (id: string) => id === defaultModel || id === `${defaultModel}:latest`;
      const others = models
        .filter((m) => m.kind === ModelKind.CHAT && !isDefault(m.id))
        .map((m) => m.id);
      return { defaultModel, ids: defaultModel ? [defaultModel, ...others] : others };
    },
  });
}

export interface ModelChoice {
  /** The model to send with a question; "" lets the llm pick its default. */
  model: string;
  /** The model shown as selected. */
  selected: string;
  ids: string[];
  defaultModel: string;
  select: (model: string) => void;
}

/** The model picked for a conversation, remembered in this browser (localStorage).
 * Without a pick, or when the picked model is gone, answers use the llm default.
 * Null while the models are loading or the llm module is unavailable. */
export function useModelChoice(conversationId: string): ModelChoice | null {
  const models = useChatModels();
  // Picks made on this page; other conversations' picks are read from storage.
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  if (!models.data?.ids.length) return null;
  const { ids, defaultModel } = models.data;
  const stored = conversationId in picks ? picks[conversationId] : readModel(conversationId);
  const model = stored && stored !== defaultModel && ids.includes(stored) ? stored : "";
  return {
    model,
    selected: model || defaultModel || (ids[0] ?? ""),
    ids,
    defaultModel,
    select: (picked) => {
      const value = picked === defaultModel ? null : picked;
      storeModel(conversationId, value);
      setPicks((p) => ({ ...p, [conversationId]: value }));
    },
  };
}

export function ModelPicker({ choice, disabled }: { choice: ModelChoice; disabled: boolean }) {
  return (
    <label className="flex items-center gap-2 text-xs text-fg-muted">
      Model
      <select
        value={choice.selected}
        disabled={disabled}
        onChange={(e) => choice.select(e.target.value)}
        className="max-w-56 truncate rounded-control border border-border bg-surface px-1.5 py-0.5 text-fg hover:border-fg-muted disabled:opacity-60"
      >
        {choice.ids.map((id) => (
          <option key={id} value={id}>
            {id === choice.defaultModel ? `${id} (default)` : id}
          </option>
        ))}
      </select>
    </label>
  );
}
