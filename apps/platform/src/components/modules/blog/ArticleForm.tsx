"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Bold, Image as ImageIcon, Italic, Link2, List, ListOrdered, Search, Settings, X } from "lucide-react";
import type { ArticleBlock, ArticleBody } from "@clinic-genie/db";
import { Button } from "@/components/ui/Button";
import { PillSelect } from "@/components/ui/PillSelect";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/Field";
import type { ActionState } from "@/lib/actions";
import { ArticleDocument, type ArticleDocumentHandle } from "./ArticleDocument";
import { MAX_BLOCKS, applyList, applyStyle, blockStyle, insertAfter, type EditorStyle } from "./article-blocks";

type Website = { id: string; name: string; platform: string; url: string | null; client_id: string; client_name: string };
type Person = { id: string; display_name: string; platform_role: string };
type Media = { id: string; alt_text: string };
type Panel = "settings" | "seo" | null;

const FORM_ID = "article-form";
const SETTING_FIELDS = new Set(["category", "slug", "websiteId", "authorUserId", "reviewerUserId", "excerpt", "featuredMediaId", "socialTitle", "socialDescription", "socialMediaId"]);
const SEO_FIELDS = new Set(["seoTitle", "seoDescription"]);

function suggestSlug(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function ToolButton({ label, pressed, disabled, onClick, children }: { label: string; pressed?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex size-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-40 ${pressed ? "bg-brand-pale text-action" : "text-ink-soft hover:bg-brand-pale"}`}
    >
      {children}
    </button>
  );
}

export function ArticleForm({
  action,
  websites,
  people,
  reviewers,
  media = [],
  article,
  lockedClientId,
  lockedWebsiteId,
  readOnly = false,
  feedback,
  backHref,
  context,
  previewHref,
  upload,
  titleHeading = false,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  websites: Website[];
  people: Person[];
  reviewers: Person[];
  media?: Media[];
  article?: {
    id: string;
    client_id: string;
    website_id: string;
    website_url?: string | null;
    title: string;
    slug: string | null;
    live_slug?: string | null;
    excerpt?: string;
    category: string;
    author_user_id: string | null;
    reviewer_user_id: string | null;
    seo_title: string;
    seo_description: string;
    social_title?: string;
    social_description?: string;
    featured_media_id?: string | null;
    social_media_id?: string | null;
    canonical_path: string | null;
    indexable: boolean;
    body: ArticleBody;
    current_version_id?: string | null;
  };
  lockedClientId?: string;
  lockedWebsiteId?: string;
  readOnly?: boolean;
  feedback?: string | null;
  backHref?: string;
  context?: string;
  previewHref?: string;
  upload?: ReactNode;
  titleHeading?: boolean;
}) {
  const [state, submit, pending] = useActionState(action, null);
  const [blocks, setBlocks] = useState<ArticleBlock[]>(article?.body.blocks.length ? article.body.blocks : [{ type: "paragraph", text: "" }]);
  const [title, setTitle] = useState(article?.title ?? "");
  const [slug, setSlug] = useState(article?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(Boolean(article?.slug));
  const [seoTitle, setSeoTitle] = useState(article?.seo_title ?? "");
  const [seoDescription, setSeoDescription] = useState(article?.seo_description ?? "");
  const [socialTitle, setSocialTitle] = useState(article?.social_title ?? "");
  const [socialDescription, setSocialDescription] = useState(article?.social_description ?? "");
  const [featuredId, setFeaturedId] = useState(article?.featured_media_id ?? "");
  const [dirty, setDirty] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [active, setActive] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkHref, setLinkHref] = useState("https://");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [toolNote, setToolNote] = useState<string | null>(null);
  const [appliedSave, setAppliedSave] = useState<ActionState>(null);
  const field = state && !state.ok ? state.field : undefined;
  const [seenField, setSeenField] = useState<string | null>(null);
  if (state?.ok && state !== appliedSave) {
    setAppliedSave(state);
    setDirty(false);
  }
  if (field && field !== seenField) {
    setSeenField(field);
    if (SEO_FIELDS.has(field)) setPanel("seo");
    else if (SETTING_FIELDS.has(field)) setPanel("settings");
  }
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  const [websiteId, setWebsiteId] = useState(lockedWebsiteId ?? article?.website_id ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  const documentRef = useRef<ArticleDocumentHandle>(null);
  const fieldError = state && !state.ok ? state.field : undefined;
  const errorFor = (name: string) => (fieldError === name && state && !state.ok ? state.error : null);
  const website = websites.find((site) => site.id === websiteId);
  const origin = (website?.url ?? article?.website_url)?.replace(/\/$/, "") ?? "";
  const saveLabel = pending ? "Saving" : state && !state.ok ? "Save failed" : dirty ? "Unsaved changes" : article ? "Saved" : "Not saved";
  const current = blocks[Math.min(active, blocks.length - 1)];
  const style = current ? blockStyle(current) : "paragraph";
  const canStyleText = !readOnly && current && current.type !== "image";
  const canFormatInline = !readOnly && (current?.type === "paragraph" || current?.type === "list");
  const featured = media.find((item) => item.id === featuredId);

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!dirty) return;
      const anchor = (event.target as HTMLElement | null)?.closest("a");
      if (!anchor || anchor.target === "_blank" || anchor.origin !== window.location.origin) return;
      if (formRef.current?.contains(anchor) && !anchor.hasAttribute("data-confirm-leave")) return;
      event.preventDefault();
      setLeaveHref(anchor.href);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [dirty]);

  function markDirty() {
    setDirty(true);
  }

  function writeBlocks(next: ArticleBlock[]) {
    markDirty();
    setBlocks(next);
    setToolNote(null);
  }

  function restyle(nextStyle: EditorStyle) {
    if (!current || current.type === "image") return;
    const turningOffList = current.type === "list" && ((nextStyle === "list" && !current.ordered) || (nextStyle === "ordered-list" && current.ordered));
    const next = turningOffList ? applyStyle(current, "paragraph") : nextStyle === "list" || nextStyle === "ordered-list" ? applyList(current, nextStyle === "ordered-list") : applyStyle(current, nextStyle);
    if (next.length > MAX_BLOCKS) {
      setToolNote("An article can contain up to 80 blocks.");
      return;
    }
    documentRef.current?.queueFocus({ index: active, item: null, offset: 0 });
    writeBlocks([...blocks.slice(0, active), ...next, ...blocks.slice(active + 1)]);
  }

  function insertLink() {
    let url: URL;
    try {
      url = new URL(linkHref.trim());
    } catch {
      setLinkError("Use an http or https address.");
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      setLinkError("Use an http or https address.");
      return;
    }
    const text = linkText.trim();
    if (!text) {
      setLinkError("Add the link text.");
      return;
    }
    const next = insertAfter(blocks, active, { type: "link", href: url.toString(), text });
    if (next.length > MAX_BLOCKS) {
      setToolNote("An article can contain up to 80 blocks.");
      return;
    }
    documentRef.current?.queueFocus({ index: active + 1, item: null, offset: text.length });
    writeBlocks(next);
    setLinkOpen(false);
  }

  function insertImage(item: Media) {
    const next = insertAfter(blocks, active, { type: "image", mediaId: item.id, alt: item.alt_text });
    if (next.length > MAX_BLOCKS) {
      setToolNote("An article can contain up to 80 blocks.");
      return;
    }
    documentRef.current?.queueFocus({ index: active + 1, item: null, offset: 0 });
    writeBlocks(next);
    setImageOpen(false);
  }

  function togglePanel(next: Exclude<Panel, null>) {
    setLinkOpen(false);
    setImageOpen(false);
    setPanel((currentPanel) => (currentPanel === next ? null : next));
  }

  return (
    <div className="bg-surface">
      <div className="sticky top-16 z-30 border-b border-line bg-surface">
        <form id={FORM_ID} ref={formRef} action={submit} onChange={markDirty}>
          {article && <input type="hidden" name="articleId" value={article.id} />}
          {article?.current_version_id && <input type="hidden" name="expectedVersionId" value={article.current_version_id} />}
          {lockedClientId && <input type="hidden" name="clientId" value={lockedClientId} />}
          {lockedWebsiteId && <input type="hidden" name="websiteId" value={lockedWebsiteId} />}
          <input type="hidden" name="slugEdited" value={slugEdited ? "true" : ""} />
          <input type="hidden" name="body" value={JSON.stringify({ layout: "clinic-article-v1", blocks })} />
          <div className="flex min-h-12 items-center gap-3 px-4 lg:px-8">
            {backHref && <Link href={backHref} data-confirm-leave className="shrink-0 text-sm text-action underline">Back</Link>}
            {context && <p className="min-w-0 truncate text-sm text-muted">{context}</p>}
            <p role="status" className={`ml-auto shrink-0 text-sm ${state && !state.ok ? "text-bad" : "text-muted"}`}>{saveLabel}</p>
            {previewHref && <Link href={previewHref} data-confirm-leave className="shrink-0 text-sm text-action underline">Preview</Link>}
            {!readOnly && <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving" : "Save draft"}</Button>}
          </div>
          <div className="relative flex items-center gap-1 overflow-x-auto border-t border-line px-2 py-1 lg:px-6" role="toolbar" aria-label="Formatting">
            <label className="sr-only" htmlFor="article-style">Text style</label>
            <PillSelect
              id="article-style"
              value={style}
              disabled={!canStyleText || style === "image"}
              onChange={(event) => restyle(event.target.value as EditorStyle)}
              className="h-11 shrink-0"
            >
              <option value="paragraph">Paragraph</option>
              <option value="heading-2">Heading 2</option>
              <option value="heading-3">Heading 3</option>
              <option value="list">Bulleted list</option>
              <option value="ordered-list">Numbered list</option>
              {style === "link" && <option value="link">Link</option>}
              {style === "image" && <option value="image">Image</option>}
            </PillSelect>
            <span className="mx-1 h-6 w-px shrink-0 bg-line" aria-hidden="true" />
            <ToolButton label="Bold" disabled={!canFormatInline} onClick={() => documentRef.current?.format("bold")}><Bold className="size-4" aria-hidden="true" /></ToolButton>
            <ToolButton label="Italic" disabled={!canFormatInline} onClick={() => documentRef.current?.format("italic")}><Italic className="size-4" aria-hidden="true" /></ToolButton>
            <span className="mx-1 h-6 w-px shrink-0 bg-line" aria-hidden="true" />
            <ToolButton label="Bulleted list" pressed={style === "list"} disabled={!canStyleText} onClick={() => restyle("list")}><List className="size-4" aria-hidden="true" /></ToolButton>
            <ToolButton label="Numbered list" pressed={style === "ordered-list"} disabled={!canStyleText} onClick={() => restyle("ordered-list")}><ListOrdered className="size-4" aria-hidden="true" /></ToolButton>
            <span className="mx-1 h-6 w-px shrink-0 bg-line" aria-hidden="true" />
            <ToolButton label="Insert link" pressed={linkOpen} disabled={readOnly} onClick={() => { setImageOpen(false); setLinkError(null); setLinkText(documentRef.current?.selectedText() || ""); setLinkHref("https://"); setLinkOpen((open) => !open); }}>
              <Link2 className="size-4" aria-hidden="true" />
            </ToolButton>
            <ToolButton label="Insert image" pressed={imageOpen} disabled={readOnly} onClick={() => { setLinkOpen(false); setImageOpen((open) => !open); }}>
              <ImageIcon className="size-4" aria-hidden="true" />
            </ToolButton>
            {(linkOpen || imageOpen) && (
              <div className="absolute left-4 top-full z-40 mt-1 w-[min(24rem,calc(100vw-3rem))] rounded-2xl border border-line bg-surface p-3 shadow-pop" onChange={(event) => event.stopPropagation()}>
                {linkOpen && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Insert link</p>
                    <input aria-label="Link text" value={linkText} maxLength={300} onChange={(event) => setLinkText(event.target.value)} className="block min-h-11 w-full rounded-xl border border-line px-3 text-sm" />
                    <input aria-label="Link address" value={linkHref} inputMode="url" maxLength={500} onChange={(event) => setLinkHref(event.target.value)} className="block min-h-11 w-full rounded-xl border border-line px-3 text-sm" />
                    {linkError && <p role="alert" className="text-xs text-bad">{linkError}</p>}
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={insertLink}>Insert</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setLinkOpen(false)}>Cancel</Button>
                    </div>
                  </div>
                )}
                {imageOpen && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Insert image</p>
                    {media.length === 0 ? (
                      <p className="text-sm text-muted">{article ? "Upload an image in Settings, then choose it here." : "Save the draft first. You can upload images after that."}</p>
                    ) : (
                      <ul className="max-h-60 space-y-1 overflow-y-auto">
                        {media.map((item) => (
                          <li key={item.id}>
                            <button type="button" className="flex min-h-11 w-full items-center rounded-xl px-2 text-left text-sm hover:bg-brand-pale" onClick={() => insertImage(item)}>{item.alt_text}</button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {article && media.length === 0 && <Button type="button" size="sm" variant="secondary" onClick={() => { setImageOpen(false); setPanel("settings"); }}>Open settings</Button>}
                    <Button type="button" size="sm" variant="ghost" onClick={() => setImageOpen(false)}>Close</Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </form>
      </div>
      <div className="flex items-start">
        <div className="min-w-0 flex-1">
          <div className="mx-auto min-h-[70vh] max-w-3xl px-5 py-8 lg:px-8">
            {titleHeading && <h1 className="sr-only">New article</h1>}
            <FormError state={state} />
            {state && !state.ok && state.field === "expectedVersionId" && <p className="mb-3 text-sm">Your typing is still in the form. Reload the article when you are ready to see the newer version.</p>}
            {feedback && <p className="mb-4 rounded-xl bg-warn-bg px-3 py-2 text-sm">Review feedback: {feedback}</p>}
            {toolNote && <p role="status" className="mb-3 text-sm text-muted">{toolNote}</p>}
            {article?.live_slug && slug && slug !== article.live_slug && <p className="mb-3 text-sm text-muted">This revision uses a different slug. The previous public path will not redirect.</p>}
            <label htmlFor="title" className="sr-only">Title</label>
            <input
              id="title"
              name="title"
              form={FORM_ID}
              value={title}
              maxLength={200}
              disabled={readOnly}
              placeholder="Article title"
              aria-invalid={Boolean(errorFor("title"))}
              aria-describedby={errorFor("title") ? "title-error" : undefined}
              onChange={(event) => { const value = event.target.value; setTitle(value); if (!slugEdited) setSlug(suggestSlug(value)); markDirty(); }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                documentRef.current?.focusAt(0, null, 0);
              }}
              className="article-title w-full bg-transparent text-3xl font-semibold tracking-tight text-ink placeholder:text-muted/50 sm:text-4xl"
            />
            {errorFor("title") && <p id="title-error" role="alert" className="mt-1 text-xs text-bad">{errorFor("title")}</p>}
            {featured && (
              <button type="button" className="mt-6 block w-full" onClick={() => setPanel("settings")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/blog-media/${featured.id}`} alt={featured.alt_text} className="w-full rounded-2xl" />
                <span className="mt-1 block text-left text-xs text-muted">Featured image. Change it in Settings.</span>
              </button>
            )}
            <div className="mt-6" id="body">
              {errorFor("body") && <p id="body-error" role="alert" className="mb-2 text-xs text-bad">{errorFor("body")}</p>}
              <ArticleDocument
                ref={documentRef}
                blocks={blocks}
                media={media}
                readOnly={readOnly}
                onActive={(index) => setActive(index)}
                onLimit={() => setToolNote("An article can contain up to 80 blocks.")}
                onChange={writeBlocks}
              />
            </div>
          </div>
        </div>
        <aside className="sticky top-40 z-20 flex shrink-0 self-start border-l border-line bg-surface">
          <div hidden={panel === null} className="absolute right-full top-0 max-h-[calc(100dvh-10rem)] w-[min(22rem,calc(100vw-7rem))] overflow-y-auto border border-line bg-surface shadow-pop">
            <div hidden={panel !== "settings"} id="settings-panel" className="space-y-5 p-4" onChange={markDirty}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Settings</h2>
                <button type="button" aria-label="Close settings" className="inline-flex size-11 items-center justify-center rounded-xl hover:bg-brand-pale" onClick={() => setPanel(null)}><X className="size-4" aria-hidden="true" /></button>
              </div>
              <Field label="Excerpt" htmlFor="excerpt" hint="Short summary shown above the article." error={errorFor("excerpt")}>
                <Textarea id="excerpt" name="excerpt" form={FORM_ID} maxLength={500} defaultValue={article?.excerpt ?? ""} disabled={readOnly} />
              </Field>
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Featured image</h3>
                <Field label="Image" htmlFor="featuredMediaId" error={errorFor("featuredMediaId")}>
                  <Select id="featuredMediaId" name="featuredMediaId" form={FORM_ID} value={featuredId} disabled={readOnly} onChange={(event) => { setFeaturedId(event.target.value); markDirty(); }}>
                    <option value="">No featured image</option>
                    {media.map((item) => <option key={item.id} value={item.id}>{item.alt_text}</option>)}
                  </Select>
                </Field>
                {upload}
                {!upload && <p className="text-xs text-muted">Save the draft first, then upload an image here.</p>}
              </section>
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Organisation</h3>
                <Field label="Category" htmlFor="category" error={errorFor("category")}>
                  <Input id="category" name="category" form={FORM_ID} maxLength={80} defaultValue={article?.category ?? ""} disabled={readOnly} />
                </Field>
                <Field label="Author" htmlFor="authorUserId" error={errorFor("authorUserId")}>
                  <Select id="authorUserId" name="authorUserId" form={FORM_ID} defaultValue={article?.author_user_id ?? ""} disabled={readOnly}>
                    <option value="">No author</option>
                    {people.map((person) => <option key={person.id} value={person.id}>{person.display_name}</option>)}
                  </Select>
                </Field>
                <Field label="Reviewer" htmlFor="reviewerUserId" error={errorFor("reviewerUserId")}>
                  <Select id="reviewerUserId" name="reviewerUserId" form={FORM_ID} defaultValue={article?.reviewer_user_id ?? ""} disabled={readOnly}>
                    <option value="">No reviewer</option>
                    {reviewers.map((person) => <option key={person.id} value={person.id}>{person.display_name}</option>)}
                  </Select>
                </Field>
              </section>
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">URL</h3>
                {!lockedWebsiteId && (
                  <Field label="Website" htmlFor="websiteId" error={errorFor("websiteId")}>
                    <Select id="websiteId" name="websiteId" form={FORM_ID} value={websiteId} disabled={readOnly || Boolean(article)} onChange={(event) => { setWebsiteId(event.target.value); markDirty(); }}>
                      <option value="">Choose a website</option>
                      {websites.filter((site) => !lockedClientId || site.client_id === lockedClientId).map((site) => (
                        <option key={site.id} value={site.id}>{site.client_name} — {site.name}</option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label="Slug" htmlFor="slug" hint="Leave this blank to suggest one from the title. A slug you edit is kept." error={errorFor("slug")}>
                  <Input id="slug" name="slug" form={FORM_ID} maxLength={80} value={slug} disabled={readOnly} onChange={(event) => { setSlugEdited(true); setSlug(event.target.value); markDirty(); }} />
                </Field>
                <p className="text-xs text-muted">Public URL: {origin && slug ? `${origin}/blog/${slug}` : "Set a website URL and slug to preview the address."}</p>
              </section>
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Social sharing</h3>
                <Field label="Sharing title" htmlFor="socialTitle" error={errorFor("socialTitle")}>
                  <Input id="socialTitle" name="socialTitle" form={FORM_ID} maxLength={200} value={socialTitle} disabled={readOnly} onChange={(event) => setSocialTitle(event.target.value)} />
                </Field>
                <Field label="Sharing description" htmlFor="socialDescription" error={errorFor("socialDescription")}>
                  <Textarea id="socialDescription" name="socialDescription" form={FORM_ID} maxLength={320} value={socialDescription} disabled={readOnly} onChange={(event) => setSocialDescription(event.target.value)} />
                </Field>
                <Field label="Sharing image" htmlFor="socialMediaId" error={errorFor("socialMediaId")}>
                  <Select id="socialMediaId" name="socialMediaId" form={FORM_ID} defaultValue={article?.social_media_id ?? ""} disabled={readOnly}>
                    <option value="">No sharing image</option>
                    {media.map((item) => <option key={item.id} value={item.id}>{item.alt_text}</option>)}
                  </Select>
                </Field>
                <div className="rounded-2xl border border-line p-3 text-sm">
                  <p className="font-medium">{socialTitle || title || "Untitled article"}</p>
                  <p className="text-muted">{socialDescription || "Sharing description"}</p>
                </div>
                <p className="text-xs text-muted">This preview illustrates a share card. It is not a guarantee of how a social platform will display the page.</p>
              </section>
            </div>
            <div hidden={panel !== "seo"} id="seo-panel" className="space-y-4 p-4" onChange={markDirty}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">SEO</h2>
                <button type="button" aria-label="Close SEO" className="inline-flex size-11 items-center justify-center rounded-xl hover:bg-brand-pale" onClick={() => setPanel(null)}><X className="size-4" aria-hidden="true" /></button>
              </div>
              <Field label="SEO title" htmlFor="seoTitle" error={errorFor("seoTitle")}>
                <Input id="seoTitle" name="seoTitle" form={FORM_ID} maxLength={200} value={seoTitle} disabled={readOnly} onChange={(event) => setSeoTitle(event.target.value)} />
              </Field>
              <Field label="Meta description" htmlFor="seoDescription" error={errorFor("seoDescription")}>
                <Textarea id="seoDescription" name="seoDescription" form={FORM_ID} maxLength={320} value={seoDescription} disabled={readOnly} onChange={(event) => setSeoDescription(event.target.value)} />
              </Field>
              <div className="rounded-2xl border border-line p-3 text-sm">
                <p className="text-action">{seoTitle || title || "SEO title"}</p>
                <p className="text-xs text-muted">{origin && slug ? `${origin}/blog/${slug}` : "example.invalid/blog/slug"}</p>
                <p>{seoDescription || "Meta description"}</p>
              </div>
              <p className="text-xs text-muted">This preview illustrates a search result. It is not a guarantee of how a search engine will display the page.</p>
              <label className="inline-flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="indexable" form={FORM_ID} defaultChecked={article?.indexable ?? true} disabled={readOnly} />
                Allow search engines to index the published page
              </label>
            </div>
          </div>
          <nav aria-label="Article details" className="flex w-20 flex-col">
            <button type="button" id="settings-rail" aria-expanded={panel === "settings"} aria-controls="settings-panel" className={`flex flex-col items-center gap-1 px-1 py-3 text-[11px] font-medium ${panel === "settings" ? "bg-brand-pale text-action" : "text-ink-soft hover:bg-brand-pale/70"}`} onClick={() => togglePanel("settings")}>
              <Settings className="size-5" aria-hidden="true" />
              Settings
            </button>
            <button type="button" id="seo-rail" aria-expanded={panel === "seo"} aria-controls="seo-panel" className={`flex flex-col items-center gap-1 px-1 py-3 text-[11px] font-medium ${panel === "seo" ? "bg-brand-pale text-action" : "text-ink-soft hover:bg-brand-pale/70"}`} onClick={() => togglePanel("seo")}>
              <Search className="size-5" aria-hidden="true" />
              SEO
            </button>
          </nav>
        </aside>
      </div>
      {leaveHref && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="leave-title" className="w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-5 text-ink shadow-pop">
            <h2 id="leave-title" className="text-lg font-semibold">Unsaved changes</h2>
            <p className="mt-2 text-sm">Save the draft, discard the changes, or stay on this page.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="submit" form={FORM_ID}>Save</Button>
              <Button type="button" variant="secondary" onClick={() => { setDirty(false); window.location.href = leaveHref; }}>Discard</Button>
              <Button type="button" variant="ghost" onClick={() => setLeaveHref(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
