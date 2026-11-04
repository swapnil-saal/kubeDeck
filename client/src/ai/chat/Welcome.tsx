import { type FC } from "react";
import { ThreadPrimitive, useAui } from "@assistant-ui/react";
import { m as motion } from "framer-motion";
import { ArrowUpRight, FileSearch, ShieldCheck, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAiConfig } from "@/ai/hooks/use-ai-config";
import { AiAvatarChip } from "./AiAvatar";
import type { Suggestion } from "./chat-config";
import { THREAD_WIDTH } from "./Messages";

const CAPABILITIES = [
  { icon: Terminal, text: "Runs kubectl live in your scope" },
  { icon: FileSearch, text: "Reads logs, events and manifests" },
  { icon: ShieldCheck, text: "Asks before it changes anything" },
];

const SuggestionCard: FC<{ suggestion: Suggestion; index: number }> = ({ suggestion, index }) => {
  const aui = useAui();
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.05 * index }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => aui.thread().append({ role: "user", content: [{ type: "text", text: suggestion.prompt }] })}
      className={cn(
        "group flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 text-left shadow-sm",
        "transition-colors hover:border-primary/50 hover:bg-primary/[0.04]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {suggestion.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-sm font-semibold text-foreground">
          {suggestion.label}
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{suggestion.description}</span>
      </span>
    </motion.button>
  );
};

/** A live problem as a one-line question: the resource, why it is flagged, and the ask. */
const AttentionChip: FC<{ item: Suggestion }> = ({ item }) => {
  const aui = useAui();
  return (
    <button
      type="button"
      onClick={() => aui.thread().append({ role: "user", content: [{ type: "text", text: item.prompt }] })}
      className={cn(
        "group flex min-w-0 items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left",
        "transition-colors hover:border-primary/50 hover:bg-primary/[0.04]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
      )}
    >
      <span className="shrink-0">{item.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[12.5px] font-medium text-foreground">{item.label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{item.description}</span>
      </span>
      <span className="shrink-0 text-[11px] font-semibold text-primary opacity-70 transition-opacity group-hover:opacity-100">Why?</span>
    </button>
  );
};

/** The empty thread: who the assistant is, what is broken right now, and a few good first questions. */
export const Welcome: FC<{ title: string; subtitle: string; attention: Suggestion[]; suggestions: Suggestion[] }> = ({
  title, subtitle, attention, suggestions,
}) => {
  const { isConfigured } = useAiConfig();
  return (
    <ThreadPrimitive.Empty>
      <div className={cn("mx-auto w-full pb-8 pt-10 sm:pt-14", THREAD_WIDTH)}>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center text-center"
        >
          <AiAvatarChip size="lg" className="mb-4" state={isConfigured ? "idle" : "offline"} />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
          <ul className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {CAPABILITIES.map(({ icon: Icon, text }) => (
              <li key={text} className="inline-flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 text-primary" />
                {text}
              </li>
            ))}
          </ul>
        </motion.div>

        {attention.length > 0 && (
          <div className="mt-9">
            <p className="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Needs attention now
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {attention.map((item) => (
                <AttentionChip key={item.label + item.description} item={item} />
              ))}
            </div>
          </div>
        )}

        {suggestions.length > 0 && (
          <div className="mt-7">
            <p className="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Start with</p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {suggestions.map((s, i) => (
                <SuggestionCard key={s.label} suggestion={s} index={i} />
              ))}
            </div>
          </div>
        )}
      </div>
    </ThreadPrimitive.Empty>
  );
};
