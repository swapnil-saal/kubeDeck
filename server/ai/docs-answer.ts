/**
 * The documentation site's chat (docmd's AI widget, pointed at /api/ai/docs): answers from the
 * built docs with the model configured for the assistant. Links are site-relative (/web/groups/). The relevant sections are picked here,
 * from the docs' full-text export, so the browser sends only the question and earlier turns.
 */
import fs from "fs";
import path from "path";
import { z } from "zod";
import { docsDir } from "../static";

export interface DocSection {
  title: string;
  url: string;
  text: string;
}

interface Indexed extends DocSection {
  terms: Map<string, number>;
  heading: Set<string>;
}

const STOP = new Set("a an and are as at be by can do does for from how i if in is it its me my of on or should so that the this to was what when where which who why will with you your".split(" "));

export const terms = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z0-9][a-z0-9_.-]*[a-z0-9]|[a-z0-9]/g) ?? []).filter((t) => t.length > 1 && !STOP.has(t));

const MAX_SECTION = 3000;

/** Splits docmd's llms-full.txt (`## [Title](/path/) (Group)` per page) into one entry per heading. */
export function splitDocs(full: string): DocSection[] {
  const out: DocSection[] = [];
  const parts = full.split(/^## \[(.+?)\]\((\/[^)]*)\)(?: \(.*\))?[ \t]*$/m);
  for (let i = 1; i + 2 < parts.length; i += 3) {
    const [page, url, raw] = [parts[i], parts[i + 1], parts[i + 2]];
    const body = raw.replace(/^\s*---\n[\s\S]*?\n---\n/, "").replace(/\n---\s*$/, "");
    for (const chunk of body.split(/^(?=#{1,3} )/m)) {
      const text = chunk.trim();
      if (!text) continue;
      const heading = /^#{1,3} (.+)$/m.exec(text)?.[1]?.trim();
      out.push({ title: heading && heading !== page ? `${page} › ${heading}` : page, url, text: text.slice(0, MAX_SECTION) });
    }
  }
  return out;
}

function index(sections: DocSection[]): Indexed[] {
  return sections.map((s) => {
    const counts = new Map<string, number>();
    for (const t of terms(s.text)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return { ...s, terms: counts, heading: new Set(terms(s.title)) };
  });
}

/** The sections that best match the question (tf-idf, headings count double), within a character budget. */
export function relevantSections(sections: DocSection[], question: string, budget = 14_000, pool = sections.length ? index(sections) : []): DocSection[] {
  const query = [...new Set(terms(question))];
  if (!query.length) return [];
  const idf = new Map(query.map((t) => [t, Math.log(1 + pool.length / (1 + pool.filter((s) => s.terms.has(t)).length))]));
  const scored = pool
    .map((s) => ({ s, score: query.reduce((sum, t) => {
      const tf = s.terms.get(t) ?? 0;
      return sum + (tf ? (1 + Math.log(tf)) * idf.get(t)! : 0) + (s.heading.has(t) ? 2 * idf.get(t)! : 0);
    }, 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const picked: DocSection[] = [];
  let used = 0;
  for (const { s } of scored) {
    if (used + s.text.length > budget) continue;
    picked.push({ title: s.title, url: s.url, text: s.text });
    used += s.text.length;
    if (picked.length >= 8) break;
  }
  return picked;
}

let cached: { file: string; mtime: number; pool: Indexed[]; sections: DocSection[] } | null = null;

/** The built docs, read again only when the build changed. */
export function loadDocs(): { sections: DocSection[]; pool: Indexed[] } | null {
  const dir = docsDir();
  if (!dir) return null;
  const file = path.join(dir, "llms-full.txt");
  let mtime: number;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return null; }
  if (cached?.file !== file || cached.mtime !== mtime) {
    const sections = splitDocs(fs.readFileSync(file, "utf-8"));
    cached = { file, mtime, sections, pool: index(sections) };
  }
  return { sections: cached.sections, pool: cached.pool };
}

/** What docmd's widget posts; its own prompt, tools and client-side context are not used. */
export const docsQuestionSchema = z.object({
  message: z.string().min(1).max(8000).transform((m) => m.replace(/\n\n\[Documentation Search Context[\s\S]*$/i, "").trim().slice(0, 2000)),
  history: z.array(z.object({ sender: z.string().max(20).optional(), text: z.string().max(20_000).optional() }).passthrough()).max(40).optional(),
  pageUrl: z.string().max(2000).optional(),
  pageTitle: z.string().max(300).optional(),
}).passthrough();

export const DOCS_INSTRUCTIONS = `You answer questions about KubeDeck, a Kubernetes dashboard that runs as a desktop app or as a shared web service, using only the documentation excerpts you are given.
- Answer directly and briefly, in Markdown. Give exact settings, commands and menu paths from the excerpts.
- Link the pages you used as Markdown links with exactly the URLs given in the excerpts, such as /web/groups/ (the docs site adds its own prefix).
- If the excerpts do not cover the question, say so in one sentence and point to the closest page. Never invent settings, flags or behaviour.`;

/** The widget resolves links against the docs' base (/docs/), so a link that already carries it would point at /docs/docs/. */
export const siteRelativeLinks = (text: string): string => text.replace(/\]\(\/docs(\/[^)\s]*)\)/g, "]($1)");

/** The prompt for one question: earlier turns, the matching sections, the question. */
export function docsPrompt(question: string, history: { sender?: string; text?: string }[], found: DocSection[], page?: string): string {
  const turns = history
    .filter((h) => h.text && !/^\[Tool (Call|Result)/.test(h.text))
    .slice(-6)
    .map((h) => `${h.sender === "user" ? "User" : "Assistant"}: ${h.text!.slice(0, 1500)}`);
  return [
    turns.length ? `Earlier in this conversation:\n${turns.join("\n")}` : "",
    page ? `The reader is on: ${page}` : "",
    found.length
      ? `Documentation excerpts:\n\n${found.map((s) => `### ${s.title}\nURL: ${s.url}\n\n${s.text}`).join("\n\n")}`
      : "No documentation section matched this question.",
    `Question: ${question}`,
  ].filter(Boolean).join("\n\n");
}
