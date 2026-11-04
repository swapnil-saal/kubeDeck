/**
 * The contract of the `/api/ai/*` endpoints, shared by server and client (types only).
 * The server validates every field with zod (`server/ai/tasks.ts`, `server/ai/translate.ts`).
 */

/** What the browser sends to `POST /api/ai/tasks/:task` as `{ input }`. Prompts are written on the server. */
export interface AiTaskInputs {
  troubleshoot: {
    resourceType: string;
    name: string;
    namespace?: string;
    context?: string;
    describe?: string;
    events?: string;
    logs?: string;
  };
  "explain-yaml": { yaml: string; resourceType?: string };
  /** `source` names what the logs belong to, e.g. `deployment "api"` */
  "summarize-logs": { source: string; logs: string };
  "summarize-events": { events: string };
  "explain-status": { resource: string; status: string };
}

export type AiTaskName = keyof AiTaskInputs;

/** `POST /api/ai/translate` body. */
export interface TranslateRequest {
  prompt: string;
  context?: string;
  namespace?: string;
  /** resource names per kind in the current scope, so fuzzy names resolve to real ones */
  resources?: Record<string, string[]>;
}

/** `POST /api/ai/translate` response. */
export interface TranslateResult {
  /** a full command line, starting with `kubectl` */
  command: string;
  /** one sentence on what the command does; may be empty */
  explanation: string;
  /** read = runs as is; write = changes the cluster; blocked = KubeDeck refuses it */
  risk: "read" | "write" | "blocked";
}
