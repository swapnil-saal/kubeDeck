import * as DialogPrimitive from "@radix-ui/react-dialog";
import { TraceWaterfall } from "./TraceWaterfall";

/** One trace in a panel from the right, over the page: the list behind it stays where it was. */
export function TraceDrawer({ traceId, context, grafanaTraceUrl, logs, onClose }: {
  traceId: string | null;
  context: string;
  grafanaTraceUrl?: string | null;
  logs: boolean;
  onClose: () => void;
}) {
  return (
    <DialogPrimitive.Root open={!!traceId} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-card shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right sm:w-[min(68rem,92vw)]"
        >
          <DialogPrimitive.Title className="sr-only">Trace {traceId}</DialogPrimitive.Title>
          {traceId && <TraceWaterfall key={traceId} traceId={traceId} context={context} grafanaTraceUrl={grafanaTraceUrl} logs={logs} onClose={onClose} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
