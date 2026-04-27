import { useEffect, useMemo } from "react"
import { useFileTree, FileTree } from "@pierre/trees/react"
import { useQuery } from "@tanstack/react-query"

interface FileTreePanelProps {
  root?: string
  onFileSelect?: (path: string) => void
}

function useLocalReadDir(root?: string) {
  return useQuery({
    queryKey: ["workbench", "readdir", root],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (root) params.set("root", root)
      const res = await fetch(`/api/v1/workbench/readdir?${params}`)
      const data = await res.json()
      return (data.paths ?? []) as string[]
    },
    staleTime: 30_000,
  })
}

export function FileTreePanel({ root, onFileSelect }: FileTreePanelProps) {
  const { data: allPaths, isLoading } = useLocalReadDir(root)

  const filePaths = useMemo(
    () => (allPaths ?? []).filter((p) => !p.endsWith("/")),
    [allPaths]
  )

  const { model } = useFileTree({
    paths: filePaths.length > 0 ? filePaths : ["(empty)"],
    initialExpansion: 1,
    flattenEmptyDirectories: true,
    sort: "default",
    search: true,
    onSelectionChange: (selected) => {
      if (selected.length > 0 && onFileSelect) {
        const path = selected[0]
        if (!path.endsWith("/")) {
          onFileSelect(path)
        }
      }
    },
  })

  useEffect(() => {
    if (filePaths.length > 0) {
      model.resetPaths(filePaths)
    }
  }, [filePaths])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span className="icon-[ph--folder-open-duotone] h-4 w-4 text-zinc-500" />
        <span className="flex-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
          Files
        </span>
        {isLoading && (
          <span className="icon-[ph--spinner] h-3 w-3 animate-spin text-zinc-400" />
        )}
        {!isLoading && filePaths.length > 0 && (
          <span className="text-xs text-zinc-400">{filePaths.length}</span>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        {filePaths.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <span className="icon-[ph--folder-dashed-duotone] h-8 w-8 text-zinc-300" />
            <p className="text-xs text-zinc-400">No files found</p>
          </div>
        ) : (
          <FileTree
            model={model}
            className="h-full"
            style={{ fontSize: "13px" }}
          />
        )}
      </div>
    </div>
  )
}
