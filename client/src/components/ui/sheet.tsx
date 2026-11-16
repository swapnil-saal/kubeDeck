/** A panel that opens from the right edge over the page (Radix dialog), for editing one thing in place. */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = DialogPrimitive.Root;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { width?: string }
>(({ className, children, width = "sm:max-w-lg", ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn("fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-background shadow-2xl outline-none", width, className)}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";

/** The sheet's fixed top: title, a line under it, and anything else (badges). */
export function SheetHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("shrink-0 border-b border-border px-5 py-4 pr-12", className)}>{children}</div>;
}

/** The scrolling middle. */
export function SheetBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5", className)}>{children}</div>;
}

/** The fixed bottom, for the form's buttons. */
export function SheetFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-5 py-3", className)}>{children}</div>;
}
