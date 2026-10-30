import { describe, expect, it } from "vitest";
import {
  applyList,
  applyTextStyle,
  insertAfter,
  insertListItem,
  joinParagraphs,
  markersToSpans,
  removeAt,
  removeListItem,
  runsToParagraph,
  splitRuns,
  spansToMarkers,
  visibleText,
} from "./article-blocks";
import type { ArticleBlock } from "@clinic-genie/db";

describe("article block editing", () => {
  it("round-trips bold and italic markers", () => {
    const text = "Keep **this** and _that_ plain";
    expect(spansToMarkers(markersToSpans(text))).toBe(text);
    expect(visibleText(text)).toBe("Keep this and that plain");
  });

  it("splits a styled sentence at the caret", () => {
    const runs = markersToSpans("Hello **bold** end");
    const [left, right] = splitRuns(runs, 8);
    expect(runsToParagraph(left)).toEqual({ type: "paragraph", text: "Hello bo", spans: [{ text: "Hello " }, { text: "bo", bold: true }] });
    expect(runsToParagraph(right)).toEqual({ type: "paragraph", text: "ld end", spans: [{ text: "ld", bold: true }, { text: " end" }] });
  });

  it("joins paragraphs and keeps both styles", () => {
    const left: ArticleBlock = { type: "paragraph", text: "A", spans: [{ text: "A", bold: true }] };
    const right: ArticleBlock = { type: "paragraph", text: "B", spans: [{ text: "B", italic: true }] };
    expect(joinParagraphs(left, right)).toEqual({
      type: "paragraph",
      text: "AB",
      spans: [{ text: "A", bold: true }, { text: "B", italic: true }],
    });
  });

  it("turns a list into paragraphs and a paragraph into a list", () => {
    const list: ArticleBlock = { type: "list", ordered: false, items: ["One", "**Two**"] };
    const paragraphs = applyTextStyle(list, "paragraph");
    expect(paragraphs).toEqual([
      { type: "paragraph", text: "One" },
      { type: "paragraph", text: "Two", spans: [{ text: "Two", bold: true }] },
    ]);
    expect(applyList(paragraphs[0]!, false)).toEqual([{ type: "list", ordered: false, items: ["One"] }]);
  });

  it("inserts the next block beside the cursor and never leaves the document empty", () => {
    const start: ArticleBlock[] = [{ type: "paragraph", text: "First" }];
    const withHeading = insertAfter(start, 0, { type: "heading", level: 2, text: "Next" });
    expect(withHeading.map((block) => block.type)).toEqual(["paragraph", "heading"]);
    expect(removeAt(withHeading, 0)).toEqual([{ type: "heading", level: 2, text: "Next" }]);
    expect(removeAt([{ type: "paragraph", text: "Only" }], 0)).toEqual([{ type: "paragraph", text: "" }]);
  });

  it("adds and removes list items", () => {
    const list = { type: "list" as const, ordered: true, items: ["A"] };
    const two = insertListItem(list, 0);
    expect(two.items).toEqual(["A", ""]);
    expect(removeListItem(two, 1)?.items).toEqual(["A"]);
    expect(removeListItem(list, 0)).toBeNull();
  });
});
