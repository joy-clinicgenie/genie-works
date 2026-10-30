import type { ArticleBlock, TextSpan } from "@clinic-genie/db";

export const MAX_BLOCKS = 80;

export type EditorStyle = "paragraph" | "heading-2" | "heading-3" | "list" | "ordered-list" | "link" | "image";

/** Same marker rules as the published renderer: **bold** and _italic_. */
export function markersToSpans(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const pattern = /\*\*([^*]+)\*\*|_([^_\n]+)_/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) spans.push({ text: text.slice(last, index) });
    if (match[1] != null) spans.push({ text: match[1], bold: true });
    else if (match[2] != null) spans.push({ text: match[2], italic: true });
    last = index + match[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans.filter((span) => span.text.length > 0);
}

export function spansToMarkers(spans: TextSpan[]): string {
  return spans.map((span) => {
    let text = span.text;
    if (span.italic) text = `_${text}_`;
    if (span.bold) text = `**${text}**`;
    return text;
  }).join("");
}

export function visibleText(text: string): string {
  const spans = markersToSpans(text);
  return spans.length ? spans.map((span) => span.text).join("") : text;
}

export function blockStyle(block: ArticleBlock): EditorStyle {
  if (block.type === "heading") return block.level === 3 ? "heading-3" : "heading-2";
  if (block.type === "list") return block.ordered ? "ordered-list" : "list";
  if (block.type === "link" || block.type === "image") return block.type;
  return "paragraph";
}

export function runsToParagraph(runs: TextSpan[]): ArticleBlock {
  const cleaned = runs.filter((run) => run.text.length > 0);
  const text = cleaned.map((run) => run.text).join("");
  if (!cleaned.some((run) => run.bold || run.italic)) return { type: "paragraph", text };
  return {
    type: "paragraph",
    text,
    spans: cleaned.map((run) => ({
      text: run.text,
      ...(run.bold ? { bold: true } : {}),
      ...(run.italic ? { italic: true } : {}),
    })),
  };
}

export function paragraphRuns(block: Extract<ArticleBlock, { type: "paragraph" }>): TextSpan[] {
  if (block.spans?.length) return block.spans.map((span) => ({ ...span }));
  const parsed = markersToSpans(block.text);
  return parsed.length ? parsed : block.text ? [{ text: block.text }] : [];
}

export function splitRuns(runs: TextSpan[], offset: number): [TextSpan[], TextSpan[]] {
  const left: TextSpan[] = [];
  const right: TextSpan[] = [];
  let seen = 0;
  for (const run of runs) {
    const start = seen;
    const end = seen + run.text.length;
    seen = end;
    if (end <= offset) {
      left.push(run);
      continue;
    }
    if (start >= offset) {
      right.push(run);
      continue;
    }
    const cut = offset - start;
    const before = run.text.slice(0, cut);
    const after = run.text.slice(cut);
    if (before) left.push({ ...run, text: before });
    if (after) right.push({ ...run, text: after });
  }
  return [left, right];
}

export function joinParagraphs(left: Extract<ArticleBlock, { type: "paragraph" }>, right: Extract<ArticleBlock, { type: "paragraph" }>): ArticleBlock {
  return runsToParagraph([...paragraphRuns(left), ...paragraphRuns(right)]);
}

export function replaceRange(blocks: ArticleBlock[], index: number, next: ArticleBlock[]): ArticleBlock[] {
  const merged = [...blocks.slice(0, index), ...next, ...blocks.slice(index + 1)];
  return merged.length ? merged : [{ type: "paragraph", text: "" }];
}

export function insertAfter(blocks: ArticleBlock[], index: number, block: ArticleBlock): ArticleBlock[] {
  const at = Math.min(blocks.length, Math.max(0, index + 1));
  return [...blocks.slice(0, at), block, ...blocks.slice(at)];
}

export function removeAt(blocks: ArticleBlock[], index: number): ArticleBlock[] {
  const next = blocks.filter((_, itemIndex) => itemIndex !== index);
  return next.length ? next : [{ type: "paragraph", text: "" }];
}

function paragraphFromItem(item: string): ArticleBlock {
  return runsToParagraph(markersToSpans(item).length ? markersToSpans(item) : [{ text: item }]);
}

export function applyTextStyle(block: ArticleBlock, style: "paragraph" | "heading-2" | "heading-3"): ArticleBlock[] {
  if (block.type === "image") return [block];
  if (block.type === "list") {
    const items = block.items.length ? block.items : [""];
    if (style === "paragraph") return items.map(paragraphFromItem);
    const level = style === "heading-3" ? 3 : 2;
    const [first, ...rest] = items;
    return [{ type: "heading", level, text: visibleText(first ?? "") }, ...rest.map(paragraphFromItem)];
  }
  if (style === "paragraph") {
    if (block.type === "paragraph") return [block];
    const text = block.type === "heading" || block.type === "link" ? block.text : "";
    return [{ type: "paragraph", text }];
  }
  const level = style === "heading-3" ? 3 : 2;
  if (block.type === "paragraph") {
    const text = paragraphRuns(block).map((run) => run.text).join("");
    return [{ type: "heading", level, text }];
  }
  const text = block.type === "heading" || block.type === "link" ? block.text : "";
  return [{ type: "heading", level, text }];
}

export function applyList(block: ArticleBlock, ordered: boolean): ArticleBlock[] {
  if (block.type === "image") return [block];
  if (block.type === "list") return [{ ...block, ordered }];
  if (block.type === "paragraph") {
    const marker = block.spans?.length ? spansToMarkers(block.spans) : block.text;
    const items = marker.split(/\n/);
    return [{ type: "list", ordered, items: items.length ? items : [""] }];
  }
  const text = block.type === "heading" || block.type === "link" ? block.text : "";
  return [{ type: "list", ordered, items: [text] }];
}

export function applyStyle(block: ArticleBlock, style: EditorStyle): ArticleBlock[] {
  if (style === "link" || style === "image") return [block];
  if (style === "list" || style === "ordered-list") return applyList(block, style === "ordered-list");
  return applyTextStyle(block, style);
}

export function withListItem(block: Extract<ArticleBlock, { type: "list" }>, itemIndex: number, text: string): Extract<ArticleBlock, { type: "list" }> {
  return { ...block, items: block.items.map((item, index) => (index === itemIndex ? text : item)) };
}

export function insertListItem(block: Extract<ArticleBlock, { type: "list" }>, itemIndex: number): Extract<ArticleBlock, { type: "list" }> {
  const items = [...block.items];
  items.splice(itemIndex + 1, 0, "");
  return { ...block, items };
}

export function removeListItem(block: Extract<ArticleBlock, { type: "list" }>, itemIndex: number): Extract<ArticleBlock, { type: "list" }> | null {
  const items = block.items.filter((_, index) => index !== itemIndex);
  if (!items.length) return null;
  return { ...block, items };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&#39;";
  });
}

export function inlineHtml(text: string, spans?: TextSpan[]): string {
  const runs = spans?.length ? spans : markersToSpans(text);
  if (!runs.length) return "";
  return runs.map((span) => {
    let html = escapeHtml(span.text);
    if (span.italic) html = `<em>${html}</em>`;
    if (span.bold) html = `<strong>${html}</strong>`;
    return html;
  }).join("");
}

export function readInline(root: HTMLElement): { text: string; spans?: TextSpan[] } {
  const spans: TextSpan[] = [];
  const walk = (node: Node, bold: boolean, italic: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\u200b/g, "").replace(/\u00a0/g, " ");
      if (!text) return;
      const last = spans[spans.length - 1];
      if (last && Boolean(last.bold) === bold && Boolean(last.italic) === italic) last.text += text;
      else {
        const span: TextSpan = { text };
        if (bold) span.bold = true;
        if (italic) span.italic = true;
        spans.push(span);
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    const name = element.tagName;
    if (name === "BR") {
      const last = spans[spans.length - 1];
      if (last && !last.bold && !last.italic) last.text += "\n";
      else spans.push({ text: "\n" });
      return;
    }
    const weight = element.style?.fontWeight;
    const nextBold = bold || name === "STRONG" || name === "B" || weight === "bold" || (weight !== "" && Number(weight) >= 600);
    const nextItalic = italic || name === "EM" || name === "I" || element.style?.fontStyle === "italic";
    for (const child of element.childNodes) walk(child, nextBold, nextItalic);
  };
  walk(root, false, false);
  const text = spans.map((span) => span.text).join("");
  if (!spans.some((span) => span.bold || span.italic)) return { text };
  return { text, spans };
}

export function plainLength(block: ArticleBlock): number {
  if (block.type === "paragraph") return paragraphRuns(block).map((run) => run.text).join("").length;
  if (block.type === "list") return 0;
  if (block.type === "image") return 0;
  return block.text.length;
}
