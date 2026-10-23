"use client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import css from "./agent.module.css";

/** Render model text as React elements; raw HTML is never executed. */
export function AssistantMessage({ content }: { content: string }) {
  return <div className={css.markdown}><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
    img: ({ alt }) => <span>{alt}</span>,
    table: ({ children }) => <div className={css.tableScroll}><table>{children}</table></div>,
  }}>{content}</Markdown></div>;
}
