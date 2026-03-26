import type { CameraMode } from "../render/camera-controller"

interface ModeToggleProps {
  mode: CameraMode
  onModeChange: (mode: CameraMode) => void
}

export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  return (
    <div className="absolute left-4 top-4 flex gap-1 rounded-lg bg-black/60 p-1 backdrop-blur-sm">
      <button
        className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
          mode === "topdown"
            ? "bg-white/20 text-white"
            : "text-white/50 hover:text-white/80"
        }`}
        onClick={() => onModeChange("topdown")}
      >
        Top-Down
      </button>
      <button
        className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
          mode === "angled"
            ? "bg-white/20 text-white"
            : "text-white/50 hover:text-white/80"
        }`}
        onClick={() => onModeChange("angled")}
      >
        Angled
      </button>
    </div>
  )
}
