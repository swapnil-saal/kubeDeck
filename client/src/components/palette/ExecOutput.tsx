import type { RefObject } from "react";

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** A command's output under its card: exit status, line count, copy and close. */
export function ExecOutput({ result, error, onCopy, onClose, outputRef }: {
  result: ExecResult | null;
  error: string | null;
  onCopy: () => void;
  onClose: () => void;
  outputRef?: RefObject<HTMLPreElement>;
}) {
  const failed = !!error || (result != null && result.code !== 0);
  const label = error ? "ERROR" : result?.code === 0 ? "OUTPUT" : `EXIT ${result?.code}`;
  const button = "px-1.5 py-0.5 rounded text-[8px] uppercase font-bold tracking-wider text-muted-foreground/60 hover:text-foreground border border-border/50 hover:bg-foreground/[0.04] transition-colors";
  return (
    <div className="border-b border-border bg-surface-inset">
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/50 bg-foreground/[0.02]">
        <span className={`text-[9px] uppercase font-bold tracking-wider ${failed ? "text-destructive/80" : "text-foreground/50"}`}>{label}</span>
        {result && (
          <span className="text-[9px] text-muted-foreground/50 tabular-nums">{(result.stdout || result.stderr).split("\n").length} lines</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={onCopy} className={button}>Copy output</button>
          <button type="button" onClick={onClose} className={button}>Close</button>
        </div>
      </div>
      <pre ref={outputRef} className="px-4 py-3 text-[10px] leading-relaxed overflow-auto max-h-60 whitespace-pre-wrap break-all">
        {error ? (
          <span className="text-destructive/80">{error}</span>
        ) : (
          <>
            {result?.stdout && <span className="text-foreground/70">{result.stdout}</span>}
            {result?.stderr && <span className="text-destructive/60">{result.stderr}</span>}
          </>
        )}
      </pre>
    </div>
  );
}
