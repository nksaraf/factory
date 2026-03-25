"use client"

import { useRef, useState } from "react"

import { cn } from "@rio.js/ui/lib/utils"

/**
 * Custom MDX component overrides for docs pages.
 * These replace default HTML elements rendered by MDX.
 */

export function MdxH1({ children, ...props }: React.ComponentProps<"h1">) {
  return (
    <h1
      className="mb-2 text-3xl font-bold tracking-tight text-foreground"
      {...props}
    >
      {children}
    </h1>
  )
}

export function MdxH2({ children, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      className="mb-3 mt-12 border-b border-border/40 pb-2 text-xl font-semibold tracking-tight text-foreground first:mt-0"
      {...props}
    >
      {children}
    </h2>
  )
}

export function MdxH3({ children, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      className="mb-2 mt-8 text-lg font-semibold tracking-tight text-foreground"
      {...props}
    >
      {children}
    </h3>
  )
}

export function MdxP({ children, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      className="mb-4 text-base leading-relaxed text-muted-foreground"
      {...props}
    >
      {children}
    </p>
  )
}

export function MdxUl({ children, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      className="mb-4 space-y-1.5 pl-1 text-base leading-relaxed text-muted-foreground"
      {...props}
    >
      {children}
    </ul>
  )
}

export function MdxLi({ children, ...props }: React.ComponentProps<"li">) {
  return (
    <li className="flex gap-2" {...props}>
      <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary-800/40" />
      <span>{children}</span>
    </li>
  )
}

export function MdxInlineCode({
  children,
  className,
  "data-theme": dataTheme,
  ...props
}: React.ComponentProps<"code"> & { "data-theme"?: string }) {
  // rehype-pretty-code wraps fenced code blocks in <code data-theme="...">
  // and inline code with data-theme too — pass through with className only
  if (
    dataTheme ||
    className?.startsWith("language-") ||
    typeof children === "object"
  ) {
    return (
      <code className={className} data-theme={dataTheme} {...props}>
        {children}
      </code>
    )
  }
  return (
    <code
      className="rounded-md border border-border/60 bg-scale-100 dark:bg-scale-800 px-1.5 py-0.5 font-mono text-sm text-primary-800 dark:text-primary-400"
      {...props}
    >
      {children}
    </code>
  )
}

export function MdxPre({
  children,
  className,
  ...props
}: React.ComponentProps<"pre">) {
  const [copied, setCopied] = useState(false)
  const codeRef = useRef<HTMLPreElement>(null)

  function handleCopy() {
    const text = codeRef.current?.textContent ?? ""
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="not-prose group relative my-4">
      <button
        onClick={handleCopy}
        className={cn(
          "absolute right-3 top-3 z-10 rounded-md px-2 py-1 text-xs font-medium transition-all",
          "border border-white/[0.08] bg-white/[0.04] text-scale-500",
          "opacity-0 group-hover:opacity-100",
          "hover:bg-white/[0.08] hover:text-scale-300",
          copied && "opacity-100 text-success-600"
        )}
        aria-label="Copy code"
      >
        <span className="flex items-center gap-1.5">
          <span
            className={
              copied ? "icon-[ph--check-bold]" : "icon-[ph--copy-bold]"
            }
          />
          {copied ? "Copied" : "Copy"}
        </span>
      </button>
      <pre
        ref={codeRef}
        className={cn(
          "overflow-x-auto rounded-xl border border-scale-800/60 px-5 py-4 font-mono text-sm leading-[1.7] shadow-sm",
          // rehype-pretty-code sets background via inline style; this is the fallback
          !className?.includes("data-theme") && "bg-[#0d1117]",
          className
        )}
        {...props}
      >
        {children}
      </pre>
    </div>
  )
}

export function MdxTable({
  children,
  ...props
}: React.ComponentProps<"table">) {
  return (
    <div className="not-prose my-6 overflow-x-auto rounded-xl border border-border/60 shadow-sm">
      <table className="w-full min-w-[600px]" {...props}>
        {children}
      </table>
    </div>
  )
}

export function MdxThead({
  children,
  ...props
}: React.ComponentProps<"thead">) {
  return (
    <thead
      className="border-b border-border/60 bg-scale-100/80 dark:bg-scale-50/5"
      {...props}
    >
      {children}
    </thead>
  )
}

export function MdxTh({ children, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-bold uppercase tracking-wider text-scale-800"
      {...props}
    >
      {children}
    </th>
  )
}

export function MdxTd({ children, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      className="border-t border-border/30 px-4 py-3 align-top text-base leading-relaxed text-scale-900 [&>code]:whitespace-nowrap [&>code]:font-mono [&>code]:text-sm"
      {...props}
    >
      {children}
    </td>
  )
}

export function MdxTr({ children, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr className="transition-colors hover:bg-accent/30" {...props}>
      {children}
    </tr>
  )
}

export function MdxHr(props: React.ComponentProps<"hr">) {
  return <hr className="my-10 border-t border-border/40" {...props} />
}

export function MdxStrong({
  children,
  ...props
}: React.ComponentProps<"strong">) {
  return (
    <strong className="font-semibold text-foreground" {...props}>
      {children}
    </strong>
  )
}

export function MdxA({ children, ...props }: React.ComponentProps<"a">) {
  return (
    <a
      className="text-primary-800 underline decoration-primary-800/30 underline-offset-2 transition-colors hover:decoration-primary-800/60"
      {...props}
    >
      {children}
    </a>
  )
}
