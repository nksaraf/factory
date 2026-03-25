import { useEffect } from "react"

const DEFAULT_TITLE =
  "SmartMarket | Market Intelligence Platform for FMCG, Retail & QSR"
const DEFAULT_DESCRIPTION =
  "SmartMarket combines enterprise data with location intelligence to power expansion strategy, distribution optimization, and revenue prediction for FMCG, Retail, and QSR businesses."

export function useDocumentMeta(title?: string, description?: string) {
  useEffect(() => {
    const prevTitle = document.title
    document.title = title || DEFAULT_TITLE

    let metaDesc = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]'
    )
    const prevDesc = metaDesc?.getAttribute("content") ?? ""

    if (metaDesc) {
      metaDesc.setAttribute("content", description || DEFAULT_DESCRIPTION)
    }

    return () => {
      document.title = prevTitle
      if (metaDesc) {
        metaDesc.setAttribute("content", prevDesc)
      }
    }
  }, [title, description])
}
