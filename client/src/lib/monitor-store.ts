/**
 * Subscribable store that aggregates `monitor_logs` tool outputs by target
 * (pod + namespace + container + grep), so repeated invocations stream into a
 * single scrollable panel instead of rendering as separate cards.
 */

export interface MonitorChunk {
  callId: string;
  at: number;            // epoch ms when this chunk was recorded
  text: string;
}

export interface MonitorTarget {
  pod?: string;
  namespace?: string;
  container?: string;
  grep?: string;
}

export interface MonitorStream {
  target: MonitorTarget;
  ownerCallId: string;       // first tool-call id that "owns" the rendering
  chunks: MonitorChunk[];
  lastUpdateAt: number;
  pendingCount: number;      // active tool calls (running) for this target
}

const MAX_CHUNKS = 500;

export function targetKey(t: MonitorTarget): string {
  return [t.pod ?? "", t.namespace ?? "", t.container ?? "", t.grep ?? ""].join("\u0001");
}

const streams = new Map<string, MonitorStream>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function subscribeMonitor(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function snapshot(): Map<string, MonitorStream> {
  return streams;
}

export function getStream(key: string): MonitorStream | undefined {
  return streams.get(key);
}

/**
 * Register a tool call against its target. The first caller becomes the owner
 * (its instance renders the panel); later callers return false and stay silent.
 */
export function registerCall(target: MonitorTarget, callId: string): { owner: boolean } {
  const key = targetKey(target);
  const existing = streams.get(key);
  if (!existing) {
    streams.set(key, {
      target,
      ownerCallId: callId,
      chunks: [],
      lastUpdateAt: Date.now(),
      pendingCount: 1,
    });
    emit();
    return { owner: true };
  }
  existing.pendingCount += 1;
  emit();
  return { owner: existing.ownerCallId === callId };
}

export function appendOutput(target: MonitorTarget, callId: string, text: string): void {
  const key = targetKey(target);
  const s = streams.get(key);
  if (!s) return;
  // Avoid duplicating: if this call already pushed a chunk, replace it.
  const idx = s.chunks.findIndex((c) => c.callId === callId);
  const chunk: MonitorChunk = { callId, at: Date.now(), text };
  if (idx >= 0) s.chunks[idx] = chunk;
  else s.chunks.push(chunk);
  if (s.chunks.length > MAX_CHUNKS) s.chunks.splice(0, s.chunks.length - MAX_CHUNKS);
  s.lastUpdateAt = Date.now();
  s.pendingCount = Math.max(0, s.pendingCount - 1);
  emit();
}

export function clearStream(key: string): void {
  if (streams.delete(key)) emit();
}

export function clearAll(): void {
  streams.clear();
  emit();
}
