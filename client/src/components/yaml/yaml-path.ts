/**
 * Where the cursor is in a Kubernetes manifest, as a field path (`spec.template.spec.containers.image`),
 * plus the document's apiVersion and kind. Works from indentation, so it keeps working while the YAML
 * is half-typed and would not parse. List items do not add a segment, which is what `kubectl explain` wants.
 */
export interface YamlLocation {
  apiVersion?: string;
  kind?: string;
  path: string[];
}

const KEY = /^(\s*)(- +)?([A-Za-z0-9_.\/-]+|"[^"]+"|'[^']+'):(\s|$)/;

/** The key a line defines and the column it starts at ("- " list markers count as indentation). */
function keyOf(line: string): { key: string; indent: number } | null {
  const m = line.match(KEY);
  if (!m) return null;
  return { key: m[3].replace(/^["']|["']$/g, ""), indent: m[1].length + (m[2]?.length ?? 0) };
}

export function locate(text: string, offset: number): YamlLocation {
  const lines = text.split("\n");
  // the cursor's line, and the bounds of its YAML document (between --- separators)
  let at = 0;
  let row = 0;
  for (; row < lines.length; row++) {
    if (at + lines[row].length >= offset) break;
    at += lines[row].length + 1;
  }
  row = Math.min(row, lines.length - 1);
  let start = row;
  while (start > 0 && !/^---/.test(lines[start - 1])) start--;
  let end = row;
  while (end + 1 < lines.length && !/^---/.test(lines[end + 1])) end++;

  const top = (key: string) => {
    for (let i = start; i <= end; i++) {
      const m = lines[i].match(new RegExp(`^${key}:\\s*["']?([^"'#\\s]+)`));
      if (m) return m[1];
    }
    return undefined;
  };

  const path: string[] = [];
  let limit = Number.POSITIVE_INFINITY;
  const here = keyOf(lines[row]);
  if (here) {
    path.unshift(here.key);
    limit = here.indent;
  } else {
    // on a blank line or a list value: the field is the nearest key above with less indentation
    limit = lines[row].match(/^\s*/)?.[0].length ?? 0;
    if (lines[row].trim() === "") limit += 1;
  }
  for (let i = row - 1; i >= start && limit > 0; i--) {
    const k = keyOf(lines[i]);
    if (!k || k.indent >= limit) continue;
    path.unshift(k.key);
    limit = k.indent;
  }
  return { apiVersion: top("apiVersion"), kind: top("kind"), path };
}

/** Fields whose keys are free-form (a map), not schema fields: explain the map, not the key in it. */
const MAP_FIELDS = new Set([
  "annotations", "labels", "data", "stringData", "binaryData", "matchLabels", "nodeSelector",
  "limits", "requests", "capacity", "allocatable", "parameters", "hard", "used",
]);
const FIELD_NAME = /^[A-Za-z][\w-]*$/;

/** The argument for `kubectl explain`, e.g. "deployment.spec.replicas"; null without a kind. */
export function explainPath(loc: YamlLocation): string | null {
  if (!loc.kind) return null;
  const fields: string[] = [];
  if (loc.path[0] !== "apiVersion" && loc.path[0] !== "kind") {
    for (const seg of loc.path) {
      if (!FIELD_NAME.test(seg)) break;
      fields.push(seg);
      if (MAP_FIELDS.has(seg)) break;
    }
  }
  return [loc.kind.toLowerCase(), ...fields].join(".");
}
