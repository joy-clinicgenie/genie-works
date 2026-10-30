"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { ArticleBlock, TextSpan } from "@clinic-genie/db";
import { PillSelect } from "@/components/ui/PillSelect";
import {
  MAX_BLOCKS,
  escapeHtml,
  inlineHtml,
  insertAfter,
  insertListItem,
  joinParagraphs,
  plainLength,
  readInline,
  removeAt,
  removeListItem,
  replaceRange,
  runsToParagraph,
  spansToMarkers,
  splitRuns,
  visibleText,
  withListItem,
} from "./article-blocks";

function caretOffset(root: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return root.textContent?.length ?? 0;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.endContainer)) return root.textContent?.length ?? 0;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

function placeCaret(root: HTMLElement, offset: number) {
  if (root instanceof HTMLInputElement || root instanceof HTMLTextAreaElement) {
    const point = Math.max(0, Math.min(offset, root.value.length));
    root.setSelectionRange(point, point);
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (seen + length >= offset) {
      const range = document.createRange();
      range.setStart(node, Math.max(0, Math.min(offset - seen, length)));
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    seen += length;
    node = walker.nextNode();
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

type Media = { id: string; alt_text: string };
type FocusTarget = { index: number; item: number | null; offset: number };

export type ArticleDocumentHandle = {
  queueFocus: (target: FocusTarget) => void;
  focusAt: (index: number, item: number | null, offset: number) => void;
  selectedText: () => string;
  format: (command: "bold" | "italic") => void;
};

function fieldKey(index: number, item: number | null) {
  return item === null ? `b${index}` : `b${index}i${item}`;
}

function RichText({
  html,
  text,
  empty,
  placeholder,
  label,
  readOnly,
  className,
  field,
  onRegister,
  onCommit,
  onFocus,
  onKeyDown,
  onPaste,
}: {
  html: string;
  text: string;
  empty: boolean;
  placeholder?: string;
  label: string;
  readOnly: boolean;
  className: string;
  field: string;
  onRegister: (field: string, node: HTMLElement | null) => void;
  onCommit: (element: HTMLDivElement) => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const focused = useRef(false);

  useLayoutEffect(() => {
    onRegister(field, nodeRef.current);
    return () => onRegister(field, null);
  }, [field, onRegister]);

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const visible = (node.textContent ?? "").replace(/\u200b/g, "").replace(/\u00a0/g, " ");
    if (node.innerHTML === html || (focused.current && document.activeElement === node && visible === text)) {
      node.dataset.empty = visible.length ? "false" : "true";
      return;
    }
    const restore = focused.current && document.activeElement === node;
    const offset = restore ? caretOffset(node) : 0;
    node.innerHTML = html;
    node.dataset.empty = empty ? "true" : "false";
    if (restore) placeCaret(node, offset);
  }, [html, text, empty]);

  return (
    <div
      ref={nodeRef}
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      data-placeholder={placeholder ?? ""}
      data-empty={empty ? "true" : "false"}
      contentEditable={readOnly ? "false" : "true"}
      suppressContentEditableWarning
      className={`article-line ${className}`}
      onFocus={() => { focused.current = true; onFocus(); }}
      onBlur={() => { focused.current = false; }}
      onInput={(event) => {
        const node = event.currentTarget;
        node.dataset.empty = node.textContent?.length ? "false" : "true";
        onCommit(node);
      }}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    />
  );
}

export const ArticleDocument = forwardRef<ArticleDocumentHandle, {
  blocks: ArticleBlock[];
  media: Media[];
  readOnly: boolean;
  onChange: (blocks: ArticleBlock[]) => void;
  onActive: (index: number, item: number | null) => void;
  onLimit: () => void;
}>(function ArticleDocument({ blocks, media, readOnly, onChange, onActive, onLimit }, ref) {
  const fields = useRef<Record<string, HTMLElement | null>>({});
  const pending = useRef<FocusTarget | null>(null);
  const [active, setActive] = useState<{ index: number; item: number | null }>({ index: 0, item: null });

  const register = useCallback((field: string, node: HTMLElement | null) => {
    if (node) fields.current[field] = node;
    else delete fields.current[field];
  }, []);

  const activate = useCallback((index: number, item: number | null) => {
    setActive({ index, item });
    onActive(index, item);
  }, [onActive]);

  const emit = useCallback((next: ArticleBlock[], focus?: FocusTarget) => {
    if (next.length > MAX_BLOCKS) {
      pending.current = null;
      onLimit();
      return;
    }
    if (focus) pending.current = focus;
    onChange(next);
  }, [onChange, onLimit]);

  const focusElement = useCallback((index: number, item: number | null, offset: number) => {
    const element = fields.current[fieldKey(index, item)];
    if (!element) return;
    element.focus();
    placeCaret(element, offset);
    activate(index, item);
  }, [activate]);

  const commitElement = useCallback((element: HTMLElement, index: number, item: number | null) => {
    const read = readInline(element);
    const block = blocks[index];
    if (!block) return;
    if (block.type === "paragraph" && item === null) {
      const paragraph = runsToParagraph(read.spans ?? (read.text ? [{ text: read.text }] : []));
      emit(blocks.map((entry, entryIndex) => (entryIndex === index ? paragraph : entry)));
      return;
    }
    if (block.type === "heading" && item === null) {
      emit(blocks.map((entry, entryIndex) => (entryIndex === index && entry.type === "heading" ? { ...entry, text: read.text } : entry)));
      return;
    }
    if (block.type === "list" && item !== null) {
      const text = read.spans?.length ? spansToMarkers(read.spans) : read.text;
      emit(blocks.map((entry, entryIndex) => (entryIndex === index && entry.type === "list" ? withListItem(entry, item, text) : entry)));
    }
  }, [blocks, emit]);

  useImperativeHandle(ref, () => ({
    queueFocus(target) {
      pending.current = target;
    },
    focusAt: focusElement,
    selectedText() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.anchorNode) return "";
      const element = fields.current[fieldKey(active.index, active.item)];
      if (!element || !element.contains(selection.anchorNode)) return "";
      return selection.toString();
    },
    format(command) {
      if (readOnly) return;
      const block = blocks[active.index];
      if (!block || (block.type !== "paragraph" && block.type !== "list")) return;
      const item = block.type === "list" ? active.item : null;
      const element = fields.current[fieldKey(active.index, item)];
      if (!element || element instanceof HTMLInputElement) return;
      element.focus();
      document.execCommand(command);
      commitElement(element, active.index, item);
    },
  }), [active, blocks, commitElement, focusElement, readOnly]);

  useLayoutEffect(() => {
    const target = pending.current;
    if (!target) return;
    pending.current = null;
    focusElement(target.index, target.item, target.offset);
  }, [blocks, focusElement]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (readOnly || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "b" && key !== "i") return;
      if (!(event.target instanceof HTMLElement) || !event.target.isContentEditable) return;
      const block = blocks[active.index];
      if (!block || (block.type !== "paragraph" && block.type !== "list")) return;
      event.preventDefault();
      const item = block.type === "list" ? active.item : null;
      const element = fields.current[fieldKey(active.index, item)];
      if (!element || element instanceof HTMLInputElement) return;
      document.execCommand(key === "b" ? "bold" : "italic");
      commitElement(element, active.index, item);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, blocks, commitElement, readOnly]);

  function onPasteParagraph(event: ClipboardEvent<HTMLDivElement>, index: number) {
    const text = event.clipboardData.getData("text/plain");
    event.preventDefault();
    if (!text || readOnly) return;
    const block = blocks[index];
    if (block?.type !== "paragraph" || !text.includes("\n")) {
      document.execCommand("insertText", false, text.replace(/\r?\n/g, " "));
      commitElement(event.currentTarget, index, null);
      return;
    }
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const read = readInline(event.currentTarget);
    const runs: TextSpan[] = read.spans ?? (read.text ? [{ text: read.text }] : []);
    const [left, right] = splitRuns(runs, caretOffset(event.currentTarget));
    const first = runsToParagraph([...left, { text: lines[0] ?? "" }]);
    const lastLine = lines[lines.length - 1] ?? "";
    const last = runsToParagraph([{ text: lastLine }, ...right]);
    const middle = lines.slice(1, -1).map((line) => ({ type: "paragraph" as const, text: line }));
    const pieces = [first, ...middle, last];
    emit(replaceRange(blocks, index, pieces), { index: index + pieces.length - 1, item: null, offset: lastLine.length });
  }

  function onParagraphKey(event: KeyboardEvent<HTMLDivElement>, index: number) {
    const block = blocks[index];
    if (!block || readOnly || (block.type !== "paragraph" && block.type !== "heading")) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (block.type === "heading") {
        emit(insertAfter(blocks, index, { type: "paragraph", text: "" }), { index: index + 1, item: null, offset: 0 });
        return;
      }
      const read = readInline(event.currentTarget);
      const runs = read.spans ?? (read.text ? [{ text: read.text }] : []);
      const [left, right] = splitRuns(runs, caretOffset(event.currentTarget));
      emit(replaceRange(blocks, index, [runsToParagraph(left), runsToParagraph(right)]), { index: index + 1, item: null, offset: 0 });
      return;
    }
    if (event.key !== "Backspace" || !selectionCollapsed() || caretOffset(event.currentTarget) !== 0 || index === 0) return;
    const previous = blocks[index - 1];
    if (block.type === "paragraph" && previous?.type === "paragraph") {
      event.preventDefault();
      const offset = plainLength(previous);
      emit(
        [...blocks.slice(0, index - 1), joinParagraphs(previous, block), ...blocks.slice(index + 1)],
        { index: index - 1, item: null, offset },
      );
      return;
    }
    if (plainLength(block) === 0) {
      event.preventDefault();
      const offset = previous ? plainLength(previous) : 0;
      emit(removeAt(blocks, index), { index: index - 1, item: null, offset });
    }
  }

  function onItemKey(event: KeyboardEvent<HTMLDivElement>, index: number, itemIndex: number) {
    const block = blocks[index];
    if (!block || block.type !== "list" || readOnly) return;
    const read = () => {
      const inline = readInline(event.currentTarget);
      return inline.spans?.length ? spansToMarkers(inline.spans) : inline.text;
    };
    if (event.key === "Enter") {
      event.preventDefault();
      const text = read();
      const current = withListItem(block, itemIndex, text);
      if (!visibleText(text).trim()) {
        const before = current.items.slice(0, itemIndex);
        const after = current.items.slice(itemIndex + 1);
        const pieces: ArticleBlock[] = [];
        if (before.length) pieces.push({ ...current, items: before });
        pieces.push({ type: "paragraph", text: "" });
        if (after.length) pieces.push({ ...current, items: after });
        emit(replaceRange(blocks, index, pieces), { index: index + (before.length ? 1 : 0), item: null, offset: 0 });
        return;
      }
      emit(replaceRange(blocks, index, [insertListItem(current, itemIndex)]), { index, item: itemIndex + 1, offset: 0 });
      return;
    }
    if (event.key !== "Backspace" || !selectionCollapsed() || caretOffset(event.currentTarget) !== 0) return;
    const text = read();
    if (visibleText(text).length > 0 && itemIndex > 0) {
      event.preventDefault();
      const previous = block.items[itemIndex - 1] ?? "";
      const items = [...block.items];
      items[itemIndex] = text;
      items.splice(itemIndex - 1, 2, previous + text);
      emit(replaceRange(blocks, index, [{ ...block, items }]), { index, item: itemIndex - 1, offset: visibleText(previous).length });
      return;
    }
    if (visibleText(text).length > 0) return;
    event.preventDefault();
    if (itemIndex > 0) {
      const previous = block.items[itemIndex - 1] ?? "";
      const removed = removeListItem(withListItem(block, itemIndex, text), itemIndex);
      if (!removed) return;
      emit(replaceRange(blocks, index, [removed]), { index, item: itemIndex - 1, offset: visibleText(previous).length });
      return;
    }
    if (block.items.length === 1) {
      const previous = blocks[index - 1];
      emit(removeAt(blocks, index), { index: Math.max(0, index - 1), item: null, offset: previous ? plainLength(previous) : 0 });
      return;
    }
    const removed = removeListItem(block, itemIndex);
    if (!removed) return;
    emit(replaceRange(blocks, index, [removed]), { index, item: 0, offset: 0 });
  }

  return (
    <div data-article-body className="space-y-4" aria-label="Article body">
      {blocks.map((block, index) => {
        if (block.type === "paragraph" || block.type === "heading") {
          const html = block.type === "heading" ? escapeHtml(block.text) : inlineHtml(block.text, block.spans);
          const empty = block.type === "heading" ? block.text.length === 0 : plainLength(block) === 0;
          return (
            <RichText
              key={`${index}-${block.type}-${block.type === "heading" ? block.level : "p"}`}
              html={html}
              text={block.text}
              empty={empty}
              placeholder={block.type === "heading" ? "Heading" : index === 0 ? "Write the article…" : undefined}
              label={block.type === "heading" ? `Heading ${index + 1}` : `Paragraph ${index + 1}`}
              readOnly={readOnly}
              field={fieldKey(index, null)}
              onRegister={register}
              className={block.type === "heading" ? (block.level === 2 ? "text-2xl font-semibold leading-snug" : "text-xl font-semibold leading-snug") : "text-base leading-7"}
              onCommit={(element) => commitElement(element, index, null)}
              onFocus={() => activate(index, null)}
              onKeyDown={(event) => onParagraphKey(event, index)}
              onPaste={(event) => onPasteParagraph(event, index)}
            />
          );
        }
        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag key={`${index}-list-${block.ordered ? "ol" : "ul"}`} className="space-y-1">
              {block.items.map((item, itemIndex) => (
                <li key={`${index}-item-${itemIndex}`} className="flex gap-3">
                  <span className="w-6 shrink-0 pt-0.5 text-right text-muted" aria-hidden="true">{block.ordered ? `${itemIndex + 1}.` : "•"}</span>
                  <RichText
                    html={inlineHtml(item)}
                    text={visibleText(item)}
                    empty={visibleText(item).length === 0}
                    label={`${block.ordered ? "Numbered" : "Bulleted"} list item ${itemIndex + 1}`}
                    readOnly={readOnly}
                    field={fieldKey(index, itemIndex)}
                    onRegister={register}
                    className="min-w-0 flex-1 text-base leading-7"
                    onCommit={(element) => commitElement(element, index, itemIndex)}
                    onFocus={() => activate(index, itemIndex)}
                    onKeyDown={(event) => onItemKey(event, index, itemIndex)}
                    onPaste={(event) => {
                      const text = event.clipboardData.getData("text/plain");
                      event.preventDefault();
                      if (!text || readOnly) return;
                      document.execCommand("insertText", false, text.replace(/\r?\n/g, " "));
                      commitElement(event.currentTarget, index, itemIndex);
                    }}
                  />
                </li>
              ))}
            </Tag>
          );
        }
        if (block.type === "link") {
          return (
            <div key={`${index}-link`} className="space-y-1">
              <input
                ref={(node) => register(fieldKey(index, null), node)}
                aria-label={`Link text ${index + 1}`}
                value={block.text}
                disabled={readOnly}
                placeholder="Link text"
                maxLength={300}
                onFocus={() => activate(index, null)}
                onChange={(event) => emit(blocks.map((entry, entryIndex) => (entryIndex === index && entry.type === "link" ? { ...entry, text: event.target.value } : entry)))}
                className="article-plain w-full bg-transparent text-base text-action underline placeholder:text-muted/60"
              />
              <input
                aria-label={`Link address ${index + 1}`}
                value={block.href}
                disabled={readOnly}
                inputMode="url"
                maxLength={500}
                onFocus={() => activate(index, null)}
                onChange={(event) => emit(blocks.map((entry, entryIndex) => (entryIndex === index && entry.type === "link" ? { ...entry, href: event.target.value } : entry)))}
                className="article-plain w-full bg-transparent text-sm text-muted"
              />
              {!readOnly && active.index === index && (
                <button type="button" className="text-sm text-muted underline" onClick={() => emit(removeAt(blocks, index), { index: Math.max(0, index - 1), item: null, offset: 0 })}>Remove link</button>
              )}
            </div>
          );
        }
        const selected = media.find((item) => item.id === block.mediaId);
        return (
          <figure
            key={`${index}-image`}
            ref={(node) => register(fieldKey(index, null), node)}
            tabIndex={0}
            aria-label={`Image ${index + 1}`}
            className="article-plain space-y-2"
            onFocus={() => activate(index, null)}
            onKeyDown={(event) => {
              if (event.key !== "Backspace" || readOnly || event.target !== event.currentTarget) return;
              event.preventDefault();
              emit(removeAt(blocks, index), { index: Math.max(0, index - 1), item: null, offset: 0 });
            }}
          >
            {block.mediaId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/blog-media/${block.mediaId}`} alt={block.alt} className="w-full rounded-2xl" />
            ) : (
              <div className="rounded-2xl bg-surface-muted px-4 py-8 text-center text-sm text-muted">Choose an image</div>
            )}
            {active.index === index && !readOnly ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <PillSelect
                  aria-label="Image"
                  value={block.mediaId}
                  onChange={(event) => {
                    const mediaId = event.target.value;
                    const alt = media.find((item) => item.id === mediaId)?.alt_text ?? block.alt;
                    emit(blocks.map((entry, entryIndex) => (entryIndex === index && entry.type === "image" ? { ...entry, mediaId, alt } : entry)));
                  }}
                  className="w-full"
                >
                  <option value="">Choose an image</option>
                  {media.map((item) => <option key={item.id} value={item.id}>{item.alt_text}</option>)}
                </PillSelect>
                <input
                  aria-label="Image alt text"
                  value={block.alt}
                  maxLength={300}
                  onChange={(event) => emit(blocks.map((entry, entryIndex) => (entryIndex === index && entry.type === "image" ? { ...entry, alt: event.target.value } : entry)))}
                  className="min-h-10 rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink"
                />
                <button type="button" className="text-left text-sm text-muted underline" onClick={() => emit(removeAt(blocks, index), { index: Math.max(0, index - 1), item: null, offset: 0 })}>Remove image</button>
              </div>
            ) : (
              <figcaption className="text-sm text-muted">{block.alt || selected?.alt_text || "Image"}</figcaption>
            )}
          </figure>
        );
      })}
      {!readOnly && (
        <button
          type="button"
          className="block min-h-32 w-full text-left"
          aria-label="Continue writing"
          onMouseDown={(event) => {
            event.preventDefault();
            const index = blocks.length - 1;
            const last = blocks[index];
            if (!last) return;
            if (last.type === "paragraph" || last.type === "heading") focusElement(index, null, plainLength(last));
            else focusElement(index, last.type === "list" ? Math.max(0, last.items.length - 1) : null, 0);
          }}
        />
      )}
    </div>
  );
});

function selectionCollapsed() {
  const selection = window.getSelection();
  return !selection || selection.isCollapsed;
}
