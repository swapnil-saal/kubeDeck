import { useCallback } from "react";
import { useCompletion } from "@ai-sdk/react";
import type { AiTaskInputs, AiTaskName } from "@shared/ai";

/** An HTTP error body is `{"message": …}` JSON; a stream error is already a sentence. */
function readableError(error: Error | undefined): string | null {
  if (!error) return null;
  try {
    const body = JSON.parse(error.message) as { message?: unknown };
    if (typeof body.message === "string") return body.message;
  } catch {
    // not JSON: use the message as is
  }
  return error.message || "Request failed";
}

/**
 * Run a one-shot AI task (`server/ai/tasks.ts`) and stream its answer.
 * Stopping, or unmounting the component, aborts the request so the model stops too.
 */
export function useAiTask<T extends AiTaskName>(task: T) {
  const { completion, complete, isLoading, error, stop, setCompletion } = useCompletion({
    api: `/api/ai/tasks/${task}`,
    credentials: "same-origin",
  });

  const run = useCallback(
    (input: AiTaskInputs[T]) => complete("", { body: { input } }),
    [complete],
  );

  const reset = useCallback(() => {
    stop();
    setCompletion("");
  }, [stop, setCompletion]);

  return { text: completion, loading: isLoading, error: readableError(error), run, stop, reset };
}
