import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownProps {
  text: string;
  className?: string;
}

/**
 * Standalone markdown renderer for one-shot AI flows (troubleshoot, explain-yaml).
 * Uses the same prose-based Tailwind styling as the streaming Thread MarkdownText.
 */
export const Markdown = memo(function Markdown({ text, className }: MarkdownProps) {
  return (
    <div
      className={`prose prose-sm dark:prose-invert max-w-none break-words
        prose-p:my-2 prose-p:leading-relaxed
        prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
        prose-h1:text-base prose-h2:text-sm prose-h3:text-sm
        prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-pre:rounded-md prose-pre:p-3 prose-pre:text-xs
        prose-code:before:content-none prose-code:after:content-none
        prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:bg-muted prose-code:text-foreground prose-code:text-[0.85em]
        prose-strong:text-foreground prose-strong:font-semibold
        prose-a:text-primary prose-a:no-underline hover:prose-a:underline
        prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5
        prose-table:text-xs prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 ${className ?? ""}`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
});
