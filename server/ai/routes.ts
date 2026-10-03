import type { Express, Request, Response } from "express";
import { chatCompletion, streamChatCompletion } from "./llm";
import { streamKubeAgent } from "./chat/agent";

/** Mounts every `/api/ai/*` endpoint. The only AI entry point the rest of the server uses. */
export function registerAiRoutes(app: Express): void {
  app.post("/api/ai/test", async (_req: Request, res: Response) => {
    try {
      const result = await chatCompletion([
        { role: "system", content: "Respond with exactly: OK" },
        { role: "user", content: "ping" },
      ]);
      res.json({ ok: true, model: result.model, response: result.content.slice(0, 100) });
    } catch (err: any) {
      res.status(500).json({ ok: false, message: err.message || "Connection failed" });
    }
  });

  // Agent chat: AI SDK UI message stream (history lives on the client).
  app.post("/api/ai/agent", async (req: Request, res: Response) => {
    const { messages, threadId, context, namespace, mode, sessionContext } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ message: "messages must be a non-empty array of UI messages" });
    }
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) abort.abort();
    });
    try {
      await streamKubeAgent(
        {
          messages,
          threadId: typeof threadId === "string" && threadId ? threadId : `thread_${Date.now()}`,
          context: typeof context === "string" && context !== "default" ? context : "",
          namespace: typeof namespace === "string" && namespace !== "all" ? namespace : "",
          mode: typeof mode === "string" ? mode : undefined,
          sessionContext: typeof sessionContext === "string" ? sessionContext : undefined,
        },
        res,
        abort.signal,
      );
    } catch (err: any) {
      if (!res.headersSent) res.status(500).json({ message: err?.message || "Agent error" });
      else res.end();
    }
  });

  app.post("/api/ai/troubleshoot", async (req, res) => {
    try {
      const { resourceType, name, namespace, context, describe, events, logs } = req.body;
      if (!name) return res.status(400).json({ message: "Missing resource name" });

      const systemPrompt = `You are a Kubernetes troubleshooting expert. Analyze the provided resource information and give a clear, actionable diagnosis. Structure your response as:
1. **Status Summary** — One-line overview
2. **Root Cause** — What's likely causing the issue
3. **Action Items** — Numbered steps to fix, with kubectl commands where applicable
4. **Risk Assessment** — Low/Medium/High and why

Be concise. Use markdown formatting. If the resource looks healthy, say so briefly.`;

      const userContent = [
        `Resource: ${resourceType}/${name} in namespace ${namespace}${context ? ` (context: ${context})` : ""}`,
        describe ? `\n### kubectl describe output:\n\`\`\`\n${describe.slice(0, 4000)}\n\`\`\`` : "",
        events ? `\n### Events:\n\`\`\`\n${events.slice(0, 2000)}\n\`\`\`` : "",
        logs ? `\n### Recent logs:\n\`\`\`\n${logs.slice(0, 3000)}\n\`\`\`` : "",
      ].filter(Boolean).join("\n");

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      try {
        const { model } = await streamChatCompletion(
          [{ role: "system", content: systemPrompt }, { role: "user", content: userContent }],
          (text) => { res.write(`data: ${JSON.stringify({ text })}\n\n`); },
        );
        res.write(`data: ${JSON.stringify({ done: true, model })}\n\n`);
      } catch (err: any) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      }
      res.end();
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Troubleshoot failed" });
    }
  });

  app.post("/api/ai/suggest", async (req: Request, res: Response) => {
    try {
      const { prompt, maxTokens } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ message: "Missing prompt" });
      }
      const result = await chatCompletion([
        { role: "system", content: "You are a concise Kubernetes assistant. Answer in plain text, no markdown. Be brief and actionable." },
        { role: "user", content: prompt },
      ], { useFastModel: true });
      const suggestion = result.content.slice(0, maxTokens || 200);
      res.json({ suggestion, model: result.model });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "AI suggest failed" });
    }
  });

  // ── AI cluster briefing: takes structured signals and returns a short SRE-style summary
  app.post("/api/ai/cluster-briefing", async (req: Request, res: Response) => {
    try {
      const { context, namespace, signals } = req.body;
      if (!signals || typeof signals !== "object") {
        return res.status(400).json({ message: "Missing signals" });
      }
      const compact = JSON.stringify(signals).slice(0, 6000);
      const systemPrompt = `You are a senior Kubernetes SRE writing a 30-second daily briefing for an operator. Be terse, scannable, and concrete.

Output MUST be valid markdown with EXACTLY these sections (no extra prose, no preamble):

**Headline:** <one sentence: overall posture — "healthy" or "X critical / Y warning, focus on Z">
**Top 3 actions** (numbered, each: one sentence + the exact kubectl command in a code span):
1. ...
2. ...
3. ...
**Watch:** <one line on what to keep an eye on, or "nothing unusual">

Rules:
- If signals show no issues, say "Cluster is healthy." for the headline and put one positive "Watch" line.
- Cite specific resource names from signals when relevant.
- Do not invent issues that aren't in signals.
- No headings other than the four labels above. No tables. Keep under 120 words.`;

      const userContent = `Context: ${context || "default"}, Namespace: ${namespace || "all"}\n\nSignals (JSON):\n${compact}`;

      const result = await chatCompletion([
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ], { useFastModel: true });

      res.json({ briefing: result.content, model: result.model });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "AI briefing failed" });
    }
  });

  const KUBECTL_TRANSLATE_SYSTEM = `You are a kubectl command translator. Convert natural language to a single kubectl command.

SYNTAX RULES (CRITICAL):
  kubectl <verb> <resource> [name] [flags]
  Flags ALWAYS go AFTER the verb/resource, NEVER before.
  CORRECT: kubectl get pods --context=mycluster -n default
  WRONG:   kubectl --context=mycluster get pods

COMMON COMMANDS:
  kubectl get <resource> [name] [-n ns] [-o wide|yaml|json]
  kubectl describe <resource> <name> [-n ns]
  kubectl logs <pod> [-n ns] [--tail=N] [-c container]
  kubectl exec -it <pod> [-n ns] -- /bin/sh
  kubectl top pods|nodes [-n ns]
  kubectl scale deployment/<name> --replicas=N [-n ns]
  kubectl rollout restart|status deployment/<name> [-n ns]
  kubectl expose <resource> <name> --type=NodePort|ClusterIP|LoadBalancer --port=P [--target-port=TP] [-n ns]
  kubectl port-forward <pod|svc/name> <local>:<remote> [-n ns]
  kubectl apply -f <file|url> [-n ns]
  kubectl delete <resource> <name> [-n ns]
  kubectl config get-contexts | current-context
  kubectl cluster-info (NOT "cluster info")
  kubectl get events [-n ns] --sort-by=.lastTimestamp

RESOURCE SHORTHANDS: po, deploy, svc, ing, cm, ns, no, rs, sts, ds, hpa, pvc, pv, sa, cj, ep

NAME RESOLUTION (CRITICAL):
- When the user uses a short word (e.g. "course", "flarum") that is meant to refer to a real resource, you MUST resolve it against the AVAILABLE RESOURCES list provided in the user message.
- Prefer an exact name match. Otherwise pick the resource whose name CONTAINS the user's token. If multiple match, pick the one of the requested kind (pod/deploy/svc/…) with the most recent / shortest suffix.
- Examples:
    "course pod logs" + pods=[e2-course-54458c5484-n2fn5, e2-flarum-…] → kubectl logs e2-course-54458c5484-n2fn5 -n <ns>
    "describe flarum"  + deploys=[e2-flarum] → kubectl describe deployment e2-flarum -n <ns>
- NEVER pick a name that isn't in the AVAILABLE RESOURCES list. If nothing matches, output a "kubectl get <kind>" command so the user can see what exists.

RULES:
- Output ONLY the kubectl command, nothing else
- No explanation, no markdown, no code fences
- Use proper flag placement
- Use resource shorthands where appropriate
- For "expose" requests, use "kubectl expose" with proper --type and --port flags`;

  app.post("/api/ai/translate", async (req: Request, res: Response) => {
    try {
      const { prompt, context, namespace, resources } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ message: "Missing prompt" });
      }
      const ctxHint = context ? ` Current context: ${context}.` : "";
      const nsHint = namespace && namespace !== "all" ? ` Current namespace: ${namespace}.` : "";

      // Format the resource catalog so the model can resolve fuzzy names.
      // Cap each kind's list so the prompt stays small.
      let resourcesHint = "";
      if (resources && typeof resources === "object") {
        const lines: string[] = [];
        for (const [kind, names] of Object.entries(resources)) {
          if (!Array.isArray(names) || names.length === 0) continue;
          const list = (names as string[]).slice(0, 50).join(", ");
          lines.push(`${kind}: ${list}`);
        }
        if (lines.length > 0) {
          resourcesHint = `\n\nAVAILABLE RESOURCES in current scope (use these EXACT names):\n${lines.join("\n")}`;
        }
      }

      const result = await chatCompletion([
        { role: "system", content: KUBECTL_TRANSLATE_SYSTEM },
        { role: "user", content: `${prompt}${ctxHint}${nsHint}${resourcesHint}` },
      ], { useFastModel: true });
      let cmd = result.content.trim()
        .replace(/^```\w*\n?/, "").replace(/\n?```$/, "")
        .replace(/^`+|`+$/g, "")
        .trim();
      // Sanitize: fix common AI mistakes
      cmd = cmd.replace(/\bcluster\s+info\b/gi, "cluster-info");
      // Fix flags before verb
      if (cmd.startsWith("kubectl ")) {
        const withoutPrefix = cmd.replace(/^kubectl\s+/, "");
        const tokens = withoutPrefix.split(/\s+/);
        const leadingFlags: string[] = [];
        let i = 0;
        while (i < tokens.length && tokens[i].startsWith("-")) {
          leadingFlags.push(tokens[i]);
          i++;
        }
        if (leadingFlags.length > 0 && i < tokens.length) {
          cmd = "kubectl " + tokens.slice(i).join(" ") + " " + leadingFlags.join(" ");
        }
      }
      res.json({ command: cmd, model: result.model });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "AI translate failed" });
    }
  });

  app.post("/api/ai/explain-yaml", async (req, res) => {
    try {
      const { yaml, resourceType } = req.body;
      if (!yaml) return res.status(400).json({ message: "Missing yaml content" });

      const systemPrompt = `You are a Kubernetes YAML expert. Explain the provided ${resourceType || "resource"} YAML manifest in plain English. Structure your response as:
1. **What This Is** — Brief description
2. **Key Configuration** — Important settings and their implications
3. **Notable Details** — Anything unusual, best-practice violations, or security concerns
4. **Related Resources** — What this resource connects to

Be concise and practical. Use markdown formatting.`;

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });

      try {
        const { model } = await streamChatCompletion(
          [{ role: "system", content: systemPrompt }, { role: "user", content: `\`\`\`yaml\n${yaml.slice(0, 6000)}\n\`\`\`` }],
          (text) => { res.write(`data: ${JSON.stringify({ text })}\n\n`); },
        );
        res.write(`data: ${JSON.stringify({ done: true, model })}\n\n`);
      } catch (err: any) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      }
      res.end();
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Explain failed" });
    }
  });
}
