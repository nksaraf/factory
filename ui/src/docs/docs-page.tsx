import { MDXProvider } from "@mdx-js/react"
import React, { Suspense } from "react"
// import { ModuleDoc, Node } from "./ast"
import { useLocation, useMatches, useParams } from "react-router"

import { SmartMarket } from "@rio.js/smart-market"
import { Button } from "@rio.js/ui/button"

// const fetchDoc = cache(async (url: string) => {
//   const res = await fetch(`/api/docs/` + url)
//   const json = await res.json()
//   return json
// })

// function ModuleDocs() {
//   const params = useParams()
//   const json = use(fetchDoc(params["*"]))
//   return (
//     <div className="space-y-8 p-12">
//       <ModuleDoc node={json}>
//         {json
//           .filter((js) => js.declarationKind === "export")
//           .map((node, index) => (
//             <React.Fragment key={index}>
//               <Node node={node} />
//             </React.Fragment>
//           ))}
//       </ModuleDoc>
//     </div>
//   )
// }

const pages = import.meta.glob("./content/**/*.{md,mdx}", {
  query: {},
})

let components = Object.fromEntries(
  Object.entries(pages).map(([path, component]) => {
    return [path.slice(0, path.lastIndexOf(".")), React.lazy(() => component())]
  }),
)

console.log(pages)

export default function DocsPage() {
  const matches = useLocation()
  let Component =
    components[`./content/${matches.pathname.replace("/docs/", "")}`]
  return (
    <MDXProvider
      components={{
        button: Button,
        Button: Button,
        // SmartMarket: () => (
        //   <SmartMarket.ProjectProvider
        //     name={matches.pathname.replace("/docs/", "")}
        //     project={{ data }}
        //     onProjectChange={() => {}}
        //   >
        //     <SmartMarket.Canvas className={"w-[50vw] h-[320px]"} />
        //   </SmartMarket.ProjectProvider>
        // ),
      }}
    >
      <div className="prose">
        <Suspense>
          <Component />
        </Suspense>
      </div>
    </MDXProvider>
  )
}
