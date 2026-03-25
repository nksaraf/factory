import {
  Check,
  Cookie,
  Copy,
  Key,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react"
import { useEffect, useState } from "react"

import { useDevtools } from "../../devtools-context"
import { JsonTree } from "../json-tree"

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className="inline-flex items-center gap-1 p-1 text-zinc-600 hover:text-zinc-300 hover:bg-[#161b22] rounded transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check size={11} className="text-emerald-400" />
      ) : (
        <Copy size={11} />
      )}
    </button>
  )
}

export function AuthInspector() {
  const { rio } = useDevtools()
  const [session, setSession] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchSession() {
      try {
        const enterprise = rio.services.get("enterprise") as any
        if (enterprise?.getSession) {
          const result = await enterprise.getSession()
          setSession(result?.data ?? result)
        } else {
          setError("Enterprise service not available")
        }
      } catch (e: any) {
        setError(e.message || "Failed to get session")
      } finally {
        setLoading(false)
      }
    }
    fetchSession()
  }, [rio])

  const jwt = localStorage.getItem("jwt")
  const bearerToken = localStorage.getItem("bearer_token")
  const sessionCookie = getCookie("better-auth.session_token")

  return (
    <div className="space-y-5">
      {/* Session */}
      <section>
        <h3 className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500 mb-2">
          <ShieldCheck size={12} />
          Session
        </h3>

        <div className="rounded-lg border border-[#1c2433] bg-[#0a0e14] p-3">
          {loading ? (
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <Loader2 size={13} className="animate-spin" />
              Loading session...
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-[11px] text-red-400">
              <ShieldAlert size={13} />
              {error}
            </div>
          ) : session ? (
            <JsonTree data={session} />
          ) : (
            <div className="text-[11px] text-zinc-500 italic">
              No active session
            </div>
          )}
        </div>
      </section>

      {/* Tokens */}
      <section>
        <h3 className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.1em] uppercase text-zinc-500 mb-2">
          <Key size={12} />
          Tokens
        </h3>

        <div className="space-y-2">
          <TokenRow label="jwt" value={jwt} />
          <TokenRow label="bearer_token" value={bearerToken} />

          {/* Session cookie */}
          <div className="rounded-lg border border-[#1c2433] bg-[#0a0e14] px-3 py-2.5 flex items-center gap-2.5">
            <Cookie size={13} className="text-zinc-600 shrink-0" />
            <span className="text-[11px] font-mono text-zinc-500 shrink-0 w-28">
              session_cookie
            </span>
            {sessionCookie ? (
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  present
                </span>
                <span className="text-[10px] text-zinc-600">
                  ({sessionCookie.length} chars)
                </span>
              </div>
            ) : (
              <span className="text-[11px] text-zinc-600 italic">not set</span>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function TokenRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border border-[#1c2433] bg-[#0a0e14] px-3 py-2.5 flex items-center gap-2.5">
      <Key size={13} className="text-zinc-600 shrink-0" />
      <span className="text-[11px] font-mono text-zinc-500 shrink-0 w-28">
        {label}
      </span>
      {value ? (
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-[11px] font-mono text-zinc-400 truncate min-w-0">
            {value.slice(0, 50)}
            {value.length > 50 && <span className="text-zinc-600">...</span>}
          </span>
          <CopyButton value={value} />
        </div>
      ) : (
        <span className="text-[11px] text-zinc-600 italic">not set</span>
      )}
    </div>
  )
}
