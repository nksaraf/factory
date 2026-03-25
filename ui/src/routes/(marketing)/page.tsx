import { useDocumentMeta } from "@/lib/use-document-meta"
import { redirect } from "react-router"

import { RioClient } from "@rio.js/client"

import HomePage from "./home-page"

export async function loader() {
  const rio = RioClient.instance
  const session = await rio.enterprise.getSession()
  console.log("session", session)
  if (session.data) {
    return redirect("/explore")
  }
}

export default function MarketingPage() {
  useDocumentMeta(
    "SmartMarket | Market Intelligence Platform for FMCG, Retail & QSR",
    "SmartMarket combines enterprise data with location intelligence to power expansion strategy, distribution optimization, and revenue prediction for FMCG, Retail, and QSR businesses."
  )

  return <HomePage />
}
