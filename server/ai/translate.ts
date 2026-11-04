import { Output, generateText } from "ai";
import { z } from "zod";
import type { TranslateRequest, TranslateResult } from "@shared/ai";
import { classifyKubectlCommand, hasShellSyntax, sanitizeKubectlCommand } from "../kubectl-safety";
import { defaultMaxOutputTokens, getLanguageModel } from "./provider";

export const translateRequestSchema: z.ZodType<TranslateRequest> = z.object({
  prompt: z.string().trim().min(1).max(500),
  context: z.string().max(253).optional(),
  namespace: z.string().max(63).optional(),
  /** resource names per kind in the current scope, so fuzzy names resolve to real ones */
  resources: z.record(z.string(), z.array(z.string())).optional(),
});

const INSTRUCTIONS = `You translate a request in plain language into ONE kubectl command.

SYNTAX: kubectl <verb> <resource> [name] [flags] — flags always AFTER the verb and resource.
  Right: kubectl get pods -n default        Wrong: kubectl -n default get pods
Use "cluster-info" (not "cluster info") and resource shorthands where natural (po, deploy, svc, ing, cm, ns, no, sts, ds, hpa, pvc, cj).

NAME RESOLUTION:
- Resolve short names the user types against AVAILABLE RESOURCES: prefer an exact match, else a name that contains the word.
- Never invent a name that is not in the list. If nothing matches, return "kubectl get <kind>" so the user can see what exists.

ONE plain kubectl command: no pipes, no $( ), no backticks, no ; or &&. If a name is unknown, return "kubectl get <kind>" instead of looking it up inside the command.
Add -n <namespace> only with the NAMESPACE given below (never use the context name as a namespace). Do not add --context; KubeDeck adds it.
Reply with JSON: {"command": "kubectl …", "explanation": "<one short sentence>"}.`;

const outputSchema = z.object({
  command: z.string().describe("The full kubectl command, starting with 'kubectl'"),
  // optional: small models behind OpenAI-compatible gateways sometimes drop it
  explanation: z.string().optional().describe("One short sentence describing what the command does"),
});

/** Strip fences and the `kubectl` prefix, move stray leading flags, then put the prefix back. */
export function normalizeKubectl(raw: string): string {
  const bare = raw.trim().replace(/^```\w*\s*|\s*```$/g, "").replace(/^`+|`+$/g, "").trim().replace(/^kubectl\s+/, "");
  return bare ? `kubectl ${sanitizeKubectlCommand(bare)}` : "";
}

function resourceCatalog(resources: TranslateRequest["resources"]): string {
  const lines = Object.entries(resources ?? {})
    .filter(([, names]) => names.length > 0)
    .map(([kind, names]) => `${kind}: ${names.slice(0, 50).join(", ")}`);
  return lines.length ? `\n\nAVAILABLE RESOURCES (use these exact names):\n${lines.join("\n")}` : "";
}

/** Natural language → one kubectl command, with an explanation and how risky it is to run. */
export async function translateToKubectl(req: TranslateRequest, abortSignal?: AbortSignal): Promise<TranslateResult> {
  const { model, provider } = getLanguageModel({ useFastModel: true });
  const namespace = req.namespace && req.namespace !== "all" ? req.namespace : "";
  const scope = [
    req.context && `CONTEXT (cluster, not a namespace): ${req.context}`,
    namespace ? `NAMESPACE: ${namespace}` : "NAMESPACE: none selected (all namespaces)",
  ].filter(Boolean).join("\n");

  const { output } = await generateText({
    model,
    instructions: INSTRUCTIONS,
    prompt: `${req.prompt}${scope ? `\n\n${scope}` : ""}${resourceCatalog(req.resources)}`,
    output: Output.object({ schema: outputSchema }),
    temperature: 0,
    maxOutputTokens: defaultMaxOutputTokens(provider),
    abortSignal,
  });

  const command = normalizeKubectl(output.command);
  return { command, explanation: output.explanation?.trim() ?? "", risk: commandRisk(command) };
}

/** How risky a palette command is. It runs as one kubectl invocation, so any shell syntax is refused. */
export function commandRisk(command: string): TranslateResult["risk"] {
  if (!command || hasShellSyntax(command)) return "blocked";
  const level = classifyKubectlCommand(command.replace(/^kubectl\s+/, ""));
  return level === "allow" ? "read" : level === "warn" ? "write" : "blocked";
}
