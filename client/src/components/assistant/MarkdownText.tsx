import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { memo } from "react";

/**
 * Smooth-streaming markdown for assistant replies.
 */
export const MarkdownText = memo(function MarkdownText() {
  return (
    <MarkdownTextPrimitive
      smooth
      remarkPlugins={[remarkGfm]}
      className="aui-md prose prose-sm dark:prose-invert max-w-none break-words
        prose-p:my-2.5 prose-p:leading-relaxed prose-p:text-foreground/90
        prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-foreground
        prose-headings:mt-5 prose-headings:mb-2
        prose-h1:text-base prose-h2:text-[15px] prose-h3:text-sm
        prose-pre:bg-muted/80 prose-pre:border prose-pre:border-border/60
        prose-pre:rounded-xl prose-pre:p-3.5 prose-pre:text-[11px] prose-pre:leading-relaxed
        prose-pre:shadow-inner
        prose-code:before:content-none prose-code:after:content-none
        prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md
        prose-code:bg-muted prose-code:text-foreground prose-code:text-[0.85em]
        prose-code:font-mono prose-code:ring-1 prose-code:ring-border/40
        prose-strong:text-foreground prose-strong:font-semibold
        prose-a:text-primary prose-a:no-underline hover:prose-a:underline
        prose-ul:my-2.5 prose-ol:my-2.5 prose-li:my-1 prose-li:marker:text-muted-foreground
        prose-hr:border-border/60 prose-blockquote:border-primary/30 prose-blockquote:text-muted-foreground
        prose-table:text-xs prose-th:px-2.5 prose-th:py-1.5 prose-td:px-2.5 prose-td:py-1.5
        prose-th:bg-muted/40 prose-th:font-semibold"
    />
  );
});
