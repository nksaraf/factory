import type { ReactNode } from "react"
import { Suspense } from "react"
import { Outlet } from "react-router"

import { AppLogo } from "@rio.js/app-ui/components/app-logo"
import { DashboardPage as DashboardPageBase } from "@rio.js/app-ui/components/dashboard-page"
import { useApp } from "@rio.js/app-ui/hooks/use-app"
import { Skeleton } from "@rio.js/ui/components/skeleton"
import { Icon } from "@rio.js/ui/icon"
import { cn } from "@rio.js/ui/lib/utils"

import { PageGroup, PageHeader } from "./page-header"

interface DashboardPageProps {
  plane: PageGroup
  icon?: string
  title: string
  description?: string
  actions?: ReactNode
  toolbar?: ReactNode
  children: ReactNode
  className?: string
  flush?: boolean
}

// export function DashboardPageHeader({
//   icon,
//   title,
//   description,
// }: {
//   icon: string
//   title: string
//   description: string
// }) {
//   return (
//     <div className="py-2 sm:py-3 md:py-5 md:bg-brand-300 bg-brand-300/80 border-brand-500 text-brand-600 bg-scale-300 group-data-[pending=true]:bg-scale-500 border-scale-500  text-scale-1200 group-data-[pending=true]:text-scale-1000 border-b rounded-t-lg flex items-center gap-4">
//       <div className="flex justify-between w-full container mx-auto px-6">
//         <div className="flex gap-4 items-center ">
//           <span className="text-emerald-500 md:hidden border-r border-scale-500">
//             <AppLogo className="size-6 md:size-8" />
//           </span>
//           <span className="text-emerald-500">
//             <Icon icon={icon} className="text-icon-xl md:text-icon-3xl " />
//           </span>
//           <div className="space-y-1">
//             <h1 className="text-xl md:text-2xl font-medium font-sans">
//               {title}
//             </h1>
//             <p className="text-base font-sans hidden md:block">{description}</p>
//           </div>
//         </div>
//       </div>
//     </div>
//   )
// }

// export function DashboardPage({
//   children,
//   icon,
//   title,
//   description,
//   backgroundImage,
//   hideHeader = false,
//   className = "",
// }: {
//   children: React.ReactNode
//   icon: string
//   className?: string
//   title: string
//   description: string
//   hideHeader?: boolean
//   backgroundImage?: string
// }) {
//   const app = useApp()
//   return (
//     <div className={cn("relative", className)}>
//       <title>{title}</title>
//       {backgroundImage && (
//         <img
//           src={backgroundImage ?? app.backgroundImage}
//           className="inset-0 object-cover h-screen w-screen pointer-events-none"
//         />
//       )}
//       <div className={`h-full w-full absolute inset-0 flex flex-col md:p-2`}>
//         <div className="flex-1 w-full h-full md:rounded-md">
//           <Suspense
//             fallback={<Skeleton className="w-full h-full md:rounded-md" />}
//           >
//             <div className="flex flex-col h-full overflow-hidden group relative md:rounded-lg">
//               {!hideHeader ? (
//                 <>
//                   <DashboardPageHeader
//                     icon={icon}
//                     title={title}
//                     description={description}
//                   />
//                   <div className="w-full min-w-0 flex-1 bg-scale-200 min-h-0 overflow-x-hidden">
//                     <div className="container mx-auto flex min-w-0 flex-col bg-scale-200 py-6 px-6 h-full overflow-x-hidden">
//                       {children || <Outlet />}
//                     </div>
//                   </div>
//                 </>
//               ) : (
//                 <div className="flex flex-col flex-1 overflow-hidden">
//                   {children || <Outlet />}
//                 </div>
//               )}
//             </div>
//           </Suspense>
//         </div>
//       </div>
//     </div>
//   )
// }

export function DashboardPage({
  plane,
  icon,
  title,
  description,
  actions,
  toolbar,
  children,
  className,
  flush,
}: DashboardPageProps) {
  // return (
  //   <DashboardPageBase
  //     icon={icon}
  //     title={title}
  //     description={description}
  //     // actions={actions}
  //     // toolbar={toolbar}
  //     children={children}
  //     className={cn("flex flex-col h-full", className)}
  //     // flush={flush}
  //   />
  // )
  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div
        className={cn(
          "px-6 pt-6 shrink-0 space-y-4 flex justify-between w-full",
          flush ? "pb-2" : "pb-4"
        )}
      >
        <PageHeader
          pageGroup={plane}
          icon={icon}
          title={title}
          description={description}
          actions={actions}
        />
        {toolbar && <div>{toolbar}</div>}
      </div>
      <div
        className={cn(
          "flex-1 min-h-0 overflow-auto",
          flush ? "" : "px-6 pb-6 pt-4"
        )}
      >
        {children}
      </div>
    </div>
  )
}
