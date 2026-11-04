import type { Express, Response } from "express";
import { generateText, pipeUIMessageStreamToResponse, streamText, toUIMessageStream } from "ai";
import { z } from "zod";
import { agentCallOptionsSchema, streamKubeAgent } from "./chat/agent";
import { formatProviderError } from "./errors";
import { defaultMaxOutputTokens, getLanguageModel } from "./provider";
import { getAiTask } from "./tasks";
import { translateRequestSchema, translateToKubectl } from "./translate";

const ONE_SHOT_TIMEOUT_MS = 90_000;

/** Abort the model call when the browser goes away, so a closed panel stops spending tokens. */
function abortOnClose(res: Response): AbortSignal {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return AbortSignal.any([controller.signal, AbortSignal.timeout(ONE_SHOT_TIMEOUT_MS)]);
}

function badRequest(res: Response, error: z.ZodError): void {
  const issue = error.issues[0];
  res.status(400).json({ message: `${issue.path.join(".") || "body"}: ${issue.message}` });
}

const agentRequestSchema = z.object({
  messages: z.array(z.unknown()).min(1),
  threadId: z.string().max(200).optional(),
  context: z.string().max(253).optional(),
  namespace: z.string().max(63).optional(),
  mode: z.string().max(32).optional(),
  sessionContext: z.string().optional(),
});

/** Mounts every `/api/ai/*` endpoint. The only AI entry point the rest of the server uses. */
export function registerAiRoutes(app: Express): void {
  /** Check the saved provider settings with a tiny request. */
  app.post("/api/ai/test", async (_req, res) => {
    try {
      const { model, modelId } = getLanguageModel();
      const { text } = await generateText({
        model,
        instructions: "Respond with exactly: OK",
        prompt: "ping",
        maxOutputTokens: 512,
        abortSignal: AbortSignal.timeout(30_000),
      });
      res.json({ ok: true, model: modelId, response: text.slice(0, 100) });
    } catch (err) {
      res.status(500).json({ ok: false, message: formatProviderError(err) });
    }
  });

  /** Agent chat: an AI SDK UI message stream. History lives on the client. */
  app.post("/api/ai/agent", async (req, res) => {
    const parsed = agentRequestSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const { messages, threadId, context, namespace, mode, sessionContext } = parsed.data;

    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const options = agentCallOptionsSchema.parse({
        scope: {
          threadId: threadId || `thread_${Date.now()}`,
          context: context && context !== "default" ? context : "",
          namespace: namespace && namespace !== "all" ? namespace : "",
        },
        mode,
        sessionContext: sessionContext?.slice(0, 10_000),
      });
      await streamKubeAgent({ messages, options }, res, controller.signal);
    } catch (err) {
      if (!res.headersSent) res.status(400).json({ message: formatProviderError(err) });
      else res.end();
    }
  });

  /** One-shot prose features (troubleshoot, explain-yaml, summaries…): see `tasks.ts`. */
  app.post("/api/ai/tasks/:task", (req, res) => {
    const task = getAiTask(req.params.task);
    if (!task) return res.status(404).json({ message: `Unknown AI task "${req.params.task}"` });
    const input = task.input.safeParse(req.body?.input);
    if (!input.success) return badRequest(res, input.error);

    let resolved: ReturnType<typeof getLanguageModel>;
    try {
      resolved = getLanguageModel({ useFastModel: task.fast });
    } catch (err) {
      return res.status(400).json({ message: formatProviderError(err) });
    }

    const result = streamText({
      model: resolved.model,
      instructions: task.instructions,
      prompt: task.prompt(input.data),
      temperature: 0.3,
      maxOutputTokens: defaultMaxOutputTokens(resolved.provider),
      abortSignal: abortOnClose(res),
    });
    pipeUIMessageStreamToResponse({
      response: res,
      stream: toUIMessageStream({ stream: result.stream, onError: formatProviderError }),
    });
  });

  /** Plain language → one kubectl command (structured output). */
  app.post("/api/ai/translate", async (req, res) => {
    const parsed = translateRequestSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    try {
      res.json(await translateToKubectl(parsed.data, abortOnClose(res)));
    } catch (err) {
      res.status(502).json({ message: formatProviderError(err) });
    }
  });
}
