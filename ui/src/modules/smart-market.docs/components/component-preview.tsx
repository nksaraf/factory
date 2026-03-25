"use client"

import { useRef, useState } from "react"

import { cn } from "@rio.js/ui/lib/utils"

export function VariantGrid({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "not-prose flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-white/50 dark:bg-scale-50/5 p-6 shadow-sm",
        "bg-[radial-gradient(circle_at_1px_1px,_hsl(var(--border)/0.3)_1px,_transparent_0)] bg-[length:24px_24px]",
        className
      )}
    >
      {children}
    </div>
  )
}

export function ComponentPreview({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "not-prose flex items-center justify-center rounded-xl border border-border/60 bg-white/50 dark:bg-scale-50/5 p-8 shadow-sm",
        "bg-[radial-gradient(circle_at_1px_1px,_hsl(var(--border)/0.3)_1px,_transparent_0)] bg-[length:24px_24px]",
        className
      )}
    >
      {children}
    </div>
  )
}

export function CodeBlock({
  children,
  className,
}: {
  children: string
  className?: string
}) {
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
    <div className={cn("not-prose group relative", className)}>
      <button
        onClick={handleCopy}
        className="absolute right-3 top-3 z-10 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-scale-500 opacity-0 backdrop-blur transition-all hover:bg-white/10 hover:text-scale-300 group-hover:opacity-100"
        aria-label="Copy code"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
      <pre
        ref={codeRef}
        className="overflow-x-auto rounded-xl border border-scale-800 bg-scale-950 px-5 py-4 text-[13px] leading-relaxed text-scale-300 shadow-sm"
      >
        <code>{children}</code>
      </pre>
    </div>
  )
}

export function PropsTable({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "not-prose overflow-x-auto rounded-xl border border-border/60 shadow-sm",
        className
      )}
    >
      <table className="w-full text-sm">{children}</table>
    </div>
  )
}
