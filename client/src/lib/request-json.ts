/**
 * One JSON request to KubeDeck's own API: sends `body` as JSON, returns the parsed answer, and throws
 * the server's own message (`{ message }`) when the status is not OK.
 */
export async function requestJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string }).message || `HTTP ${res.status}`);
  return data as T;
}
