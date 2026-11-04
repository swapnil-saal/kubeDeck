import { z } from "zod";
import type { AiTaskInputs, AiTaskName } from "@shared/ai";

/**
 * One-shot AI features that stream prose back to the browser. The browser sends data
 * (a manifest, logs, events); the prompt is written here, never by the client.
 *
 * Add a feature: describe its input in `shared/ai.ts`, add an entry here, then call
 * `useAiTask("<name>")` on the client.
 */
export interface AiTask<INPUT> {
  /** validates and trims what the browser sends */
  input: z.ZodType<INPUT, z.ZodTypeDef, unknown>;
  /** use the configured fast model (short answers) */
  fast?: boolean;
  instructions: string;
  prompt: (input: INPUT) => string;
}

/** Text the browser sends, cut to a size the prompt can afford. */
const clipped = (max: number) => z.string().transform((s) => s.slice(0, max));
const name = z.string().min(1).max(253);
const fenced = (label: string, text: string) => `### ${label}\n\`\`\`\n${text}\n\`\`\``;

function defineTask<SCHEMA extends z.ZodTypeAny>(task: {
  input: SCHEMA;
  fast?: boolean;
  instructions: string;
  prompt: (input: z.output<SCHEMA>) => string;
}): AiTask<z.output<SCHEMA>> {
  return task as AiTask<z.output<SCHEMA>>;
}

export const AI_TASKS = {
  troubleshoot: defineTask({
    input: z.object({
      resourceType: z.string().min(1).max(63),
      name,
      namespace: z.string().max(63).optional(),
      context: z.string().max(253).optional(),
      describe: clipped(4000).optional(),
      events: clipped(2000).optional(),
      logs: clipped(3000).optional(),
    }),
    instructions: `You are a Kubernetes troubleshooting expert. Analyze the provided resource information and give a clear, actionable diagnosis. Structure your response as:
1. **Status Summary** — One-line overview
2. **Root Cause** — What's likely causing the issue
3. **Action Items** — Numbered steps to fix, with kubectl commands where applicable
4. **Risk Assessment** — Low/Medium/High and why

Be concise. Use markdown formatting. If the resource looks healthy, say so briefly.`,
    prompt: ({ resourceType, name, namespace, context, describe, events, logs }) =>
      [
        `Resource: ${resourceType}/${name}${namespace ? ` in namespace ${namespace}` : ""}${context ? ` (context: ${context})` : ""}`,
        describe && fenced("kubectl describe", describe),
        events && fenced("Events", events),
        logs && fenced("Recent logs", logs),
      ].filter(Boolean).join("\n\n"),
  }),

  "explain-yaml": defineTask({
    input: z.object({ yaml: clipped(6000).pipe(z.string().min(1)), resourceType: z.string().max(63).optional() }),
    instructions: `You are a Kubernetes YAML expert. Explain the provided manifest in plain English. Structure your response as:
1. **What This Is** — Brief description
2. **Key Configuration** — Important settings and their implications
3. **Notable Details** — Anything unusual, best-practice violations, or security concerns
4. **Related Resources** — What this resource connects to

Be concise and practical. Use markdown formatting.`,
    prompt: ({ yaml, resourceType }) => `${resourceType ? `A ${resourceType} manifest:\n` : ""}\`\`\`yaml\n${yaml}\n\`\`\``,
  }),

  "summarize-logs": defineTask({
    input: z.object({
      /** what the logs belong to, e.g. `deployment "api"` */
      source: z.string().min(1).max(300),
      logs: clipped(7000).pipe(z.string().min(1)),
    }),
    fast: true,
    instructions: `You are an SRE reading recent application logs (health checks already removed).
Answer in 4-6 short bullet points: what is happening, any errors and their likely root cause, and the single next step to take.
Be specific and cite log messages. Plain text bullets, no headings.`,
    prompt: ({ source, logs }) => `Recent logs from ${source}:\n\n${logs}`,
  }),

  "summarize-events": defineTask({
    input: z.object({ events: clipped(2000).pipe(z.string().min(1)) }),
    fast: true,
    instructions:
      "Summarize Kubernetes events in 1-2 plain sentences, highlighting failures and warnings. No markdown, no preamble.",
    prompt: ({ events }) => events,
  }),

  "explain-status": defineTask({
    input: z.object({ resource: name, status: z.string().min(1).max(100) }),
    fast: true,
    instructions:
      "You are a concise Kubernetes assistant. In one plain sentence, say why a resource has the given status and how to fix it. No markdown.",
    prompt: ({ resource, status }) => `Resource "${resource}" has status "${status}".`,
  }),
} satisfies { [K in AiTaskName]: AiTask<AiTaskInputs[K]> };

export function getAiTask(task: string): AiTask<unknown> | undefined {
  return Object.hasOwn(AI_TASKS, task) ? (AI_TASKS[task as AiTaskName] as AiTask<unknown>) : undefined;
}
