import { db, storage } from "~/src/db"

import { rio } from "@rio.js/client"
import { env } from "@rio.js/env"
import { WebGISProvider } from "@rio.js/gis/components/web-gis-provider"
import { toast } from "@rio.js/ui/use-toast"

// Custom cache implementation that clears when switching projects
let projectCache = new Map()
let currentProjectName = null
let pendingRequests = new Map()

// const fetchProject = async (name) => {
//   // If this is a different project than the last one, clear the cache
//   if (currentProjectName && currentProjectName !== name) {
//     projectCache.clear()
//     pendingRequests.clear()
//     currentProjectName = name
//   } else if (!currentProjectName) {
//     currentProjectName = name
//   }

//   // Check if we have cached data for this project
//   if (projectCache.has(name)) {
//     return projectCache.get(name)
//   }

//   // Check if there's already a pending request for this project
//   if (pendingRequests.has(name)) {
//     return pendingRequests.get(name)
//   }

//   // Create the fetch promise
//   const fetchPromise = (async () => {
//     let t = toast({
//       variant: "loading",
//       title: "Loading project...",
//     })
//     let response = await fetch(
//       `${
//         storage.config.url
//       }/object/projects/${name}/project.json?v=${Date.now()}`,
//       {
//         headers: {
//           Apikey: storage.config.key,
//           Authorization: `Bearer ${await rio.auth.getAccessToken()}`,
//         },
//       },
//     )

//     if (response.ok) {
//       const data = await response.json()
//       // Add a timestamp to ensure the object reference changes
//       data._fetchedAt = Date.now()
//       t.update({
//         variant: "success",
//         title: "Project loaded successfully",
//       })
//       // Cache the result
//       projectCache.set(name, data)
//       pendingRequests.delete(name)
//       return data
//     }

//     // if (data.error) {
//     t.update({
//       variant: "error",
//       title: "Failed to load project",
//     })
//     const fallbackData = {
//       layers: [],
//       layerGroups: [],
//       aggregations: [],

//       values: {
//         baseMapProvider: "mapbox",
//         baseMapStyle: "mapbox://styles/mapbox/streets-v11",
//         colorMode: "light",
//         autoSave: false,
//         canSave: false,
//       },
//       // }
//     }
//     // Cache the fallback result
//     projectCache.set(name, fallbackData)
//     pendingRequests.delete(name)
//     return fallbackData
//   })()

//   // Store the pending request
//   pendingRequests.set(name, fetchPromise)
//   return fetchPromise
// }

// // Add a method to clear the cache
// fetchProject.clear = () => {
//   projectCache.clear()
//   pendingRequests.clear()
//   currentProjectName = null
// }

// // Make fetchProject available globally for cache clearing from other components
// if (typeof window !== "undefined") {
//   ;(window as any).fetchProject = fetchProject
// }

// function getFormattedTimestamp() {
//   const now = new Date()

//   const year = now.getFullYear()
//   const month = String(now.getMonth() + 1).padStart(2, "0")
//   const day = String(now.getDate()).padStart(2, "0")
//   const hours = String(now.getHours()).padStart(2, "0")
//   const minutes = String(now.getMinutes()).padStart(2, "0")
//   const seconds = String(now.getSeconds()).padStart(2, "0")

//   return `${year}${month}${day}_${hours}${minutes}${seconds}`
// }

// async function backupProject(id) {
//   let { error } = await storage
//     .from("projects")
//     .copy(`${id}/project.json`, `${id}/${getFormattedTimestamp()}.json`)

//   if (error) {
//     throw new Error(error.message)
//   }
// }
// async function updateProject(id, value, tabId) {
//   try {
//     const encodedData = btoa(
//       encodeURIComponent(JSON.stringify(value)).replace(
//         /%([0-9A-F]{2})/g,
//         (_, p1) => String.fromCharCode("0x" + p1),
//       ),
//     )

//     const uploadResponse = await fetch(
//       `${env.PUBLIC_SMART_FLOW_URL}/project/${id}/update`,
//       {
//         method: "POST",
//         body: JSON.stringify({
//           encoded_data: encodedData,
//           save_tab_id: tabId,
//         }),
//         headers: {
//           "Content-Type": "application/json",
//           Authorization: `Bearer ${await rio.auth.getAccessToken()}`,
//         },
//       },
//     )

//     if (!uploadResponse.ok) {
//       toast({
//         variant: "error",
//         title: "Failed to save project",
//         description: uploadResponse.statusText,
//       })
//       return false
//     }

//     const { error } = await db.public
//       .from("projects")
//       .update({
//         updated_at: new Date().toISOString(),
//       })
//       .eq("id", id)

//     if (error) {
//       console.error(
//         "Failed to update updated_at column in projects table",
//         error,
//       )
//     }

//     return true
//   } catch (error) {
//     console.error("Error in updateProject:", error)
//     toast({
//       variant: "error",
//       title: "Error saving project",
//       description: error.message,
//     })
//     return false
//   }
// }

export function ExploreProjectProvider({ name, children }) {
  return (
    <>
      <WebGISProvider
        initialProject={{
          maps: {
            main: {
              id: "main",
              provider: "google",
              style: "light-street",
              visible: true,
              settings: {
                apiKey: env.PUBLIC_GOOGLE_MAPS_API_KEY,
              },
            },
          },
        }}
        key={"explore"}
        refreshProject={() => {
          //   fetchProject.clear()
          //   currentProjectName = null
          //   return fetchProject(name)
          void Promise.resolve()
        }}
        id={"explore"}
        onProjectChange={() => {
          return true
        }}
      >
        {children}
      </WebGISProvider>
    </>
  )
}
