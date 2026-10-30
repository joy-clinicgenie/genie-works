import type { ReactNode } from "react";
import type { ArticleBody, TextSpan } from "@clinic-genie/db";

function spans(text: string, rich?: TextSpan[]) {
  const source = rich?.length ? rich : [{ text }];
  return source.map((span, index) => {
    let node: ReactNode = span.text;
    if (span.italic) node = <em key={index}>{node}</em>;
    if (span.bold) node = <strong key={index}>{node}</strong>;
    return <span key={index}>{node}</span>;
  });
}

/** Staff preview uses the same block order as the public article contract. */
export function ArticleLayout({
  title,
  excerpt,
  category,
  author,
  publishedOn,
  featuredSrc,
  featuredAlt,
  body,
  imageSrc,
}: {
  title: string;
  excerpt?: string;
  category?: string;
  author?: string | null;
  publishedOn?: string | null;
  featuredSrc?: string | null;
  featuredAlt?: string | null;
  body: ArticleBody;
  imageSrc: (mediaId: string) => string;
}) {
  const byline = [author, category, publishedOn].filter(Boolean).join(" · ");
  return (
    <article className="mx-auto max-w-2xl">
      {byline && <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{byline}</p>}
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{title || "Untitled article"}</h1>
      {excerpt?.trim() && <p className="mt-4 text-lg text-ink-soft">{excerpt}</p>}
      {featuredSrc && (
        <figure className="mt-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={featuredSrc} alt={featuredAlt || ""} className="w-full rounded-2xl" />
        </figure>
      )}
      <div className="mt-6 space-y-4 text-base leading-7 text-ink">
        {body.blocks.map((block, index) => {
          if (block.type === "heading") {
            const Tag = block.level === 2 ? "h2" : "h3";
            return <Tag key={index} className={block.level === 2 ? "text-2xl font-semibold" : "text-xl font-semibold"}>{block.text}</Tag>;
          }
          if (block.type === "list") {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={index} className={block.ordered ? "list-decimal pl-5" : "list-disc pl-5"}>
                {block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
              </Tag>
            );
          }
          if (block.type === "link") {
            return <p key={index}><a href={block.href} className="text-action underline" rel="noreferrer">{block.text}</a></p>;
          }
          if (block.type === "image") {
            return (
              <figure key={index}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageSrc(block.mediaId)} alt={block.alt} className="w-full rounded-2xl" />
              </figure>
            );
          }
          return <p key={index}>{block.spans?.length ? spans(block.text, block.spans) : block.text}</p>;
        })}
      </div>
    </article>
  );
}
