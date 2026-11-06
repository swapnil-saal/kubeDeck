import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Copies `text`; shows a check for a moment. With children, they are the label before the icon. */
export function CopyButton({ text, title = "Copy", className, children }: { text: string; title?: string; className?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { void navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <button
      type="button"
      onClick={copy}
      title={title}
      className={cn("inline-flex min-w-0 items-center gap-1.5 rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground", className)}
    >
      {children}
      {copied ? <Check className="h-3 w-3 shrink-0 text-foreground/60" /> : <Copy className="h-3 w-3 shrink-0" />}
    </button>
  );
}
