import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReactNode } from "react";

type LegalDocumentName = "privacy" | "terms";

function clean(value: string): string {
  return value.replaceAll("\\.", ".");
}

function inlineMarkdown(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;

  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(clean(value.slice(cursor, index)));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(<strong key={`${index}-strong`}>{clean(token.slice(2, -2))}</strong>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a
            key={`${index}-link`}
            href={link[2]}
            className="font-medium text-primary underline decoration-brand-gold decoration-2 underline-offset-4 hover:text-gold-text"
          >
            {link[1]}
          </a>,
        );
      }
    }
    cursor = index + token.length;
  }
  if (cursor < value.length) nodes.push(clean(value.slice(cursor)));
  return nodes;
}

function renderMarkdown(source: string): ReactNode[] {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim() || line.trim() === "---") {
      index += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].replace(/^\*\*|\*\*$/g, "");
      if (level === 1) {
        blocks.push(
          <h1 key={`h-${index}`} className="text-3xl font-bold sm:text-4xl">
            {inlineMarkdown(text)}
          </h1>,
        );
      } else if (level === 2) {
        blocks.push(
          <h2 key={`h-${index}`} className="mt-10 border-b border-brand-gold/35 pb-3 text-xl font-bold sm:text-2xl">
            {inlineMarkdown(text)}
          </h2>,
        );
      } else {
        blocks.push(
          <h3 key={`h-${index}`} className="mt-7 text-lg font-semibold">
            {inlineMarkdown(text)}
          </h3>,
        );
      }
      index += 1;
      continue;
    }

    if (/^\*\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\*\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\*\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`list-${index}`} className="ml-5 list-disc space-y-2 marker:text-brand-gold">
          {items.map((item, itemIndex) => (
            <li key={`${itemIndex}-${item.slice(0, 20)}`}>{inlineMarkdown(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      lines[index].trim() !== "---" &&
      !/^(#{1,3})\s+/.test(lines[index]) &&
      !/^\*\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p key={`p-${index}`} className="leading-7 text-foreground/90">
        {paragraph.flatMap((part, partIndex) => [
          ...inlineMarkdown(part),
          partIndex < paragraph.length - 1 ? (part.endsWith("  ") ? <br key={`br-${partIndex}`} /> : " ") : null,
        ])}
      </p>,
    );
  }

  return blocks;
}

export async function LegalDocument({ document }: { document: LegalDocumentName }) {
  const filePath =
    document === "privacy"
      ? path.join(process.cwd(), "privacy.md")
      : path.join(process.cwd(), "terms-of-service.md");
  const source = await readFile(filePath, "utf8");

  return (
    <article className="page-container py-10 sm:py-14">
      <div className="mx-auto max-w-3xl rounded-2xl border bg-card px-5 py-8 shadow-sm sm:px-10 sm:py-12">
        <div className="space-y-5">{renderMarkdown(source)}</div>
      </div>
    </article>
  );
}
