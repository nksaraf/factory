import type { ReactNode } from "react"

import type { AlertNarrativeToken } from "../utils/alert-narrative"

export interface AlertNarrativeProps {
  tokens: AlertNarrativeToken[]
}

function renderToken(token: AlertNarrativeToken, index: number | string): ReactNode {
  if (token.type === "text") {
    return (
      <span key={`text-${index}`}>
        {token.value}
      </span>
    )
  }

  if (token.type === "metric") {
    return (
      <span
        key={`metric-${index}`}
        className="inline"
      >
        {token.label ? (
          <>
            <span>{token.label}: </span>
            <span className="font-bold ">{token.value}</span>
          </>
        ) : (
          <span className="font-bold  ">{token.value}</span>
        )}
      </span>
    )
  }

  // line-break - should not be rendered directly, handled by paragraph grouping
  return null
}

export function AlertNarrative({ tokens }: AlertNarrativeProps) {
  if (!tokens || tokens.length === 0) return null

  // Group tokens into bullet points (separated by line-break tokens)
  const bullets: AlertNarrativeToken[][] = []
  let currentBullet: AlertNarrativeToken[] = []

  for (const token of tokens) {
    if (token.type === "line-break") {
      if (currentBullet.length > 0) {
        bullets.push(currentBullet)
        currentBullet = []
      }
    } else {
      currentBullet.push(token)
    }
  }

  // Add the last bullet if it has tokens
  if (currentBullet.length > 0) {
    bullets.push(currentBullet)
  }

  return (
    <ul className="text-sm text-scale-1100 leading-relaxed space-y-1 list-none pl-1">
      {bullets.map((bulletTokens, bulletIndex) => (
        <li key={`bullet-${bulletIndex}`} className="flex items-start gap-2">
          <span className="leading-relaxed">•</span>
          <span className="flex-1 leading-relaxed">
            {bulletTokens.map((token, tokenIndex) =>
              renderToken(token, `${bulletIndex}-${tokenIndex}`)
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}


