import { Component, type ReactNode } from "react"
import { Button } from "@rio.js/ui/button"
import { Icon } from "@rio.js/ui/icon"

type Props = {
  children: ReactNode
  fallback?: ReactNode
}

type State = {
  hasError: boolean
  error: Error | null
  isExpanded: boolean
}

/**
 * Error boundary component for road detail cards
 * Catches errors in child components and displays a collapsible fallback UI
 */
export class RoadCardErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, isExpanded: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, isExpanded: false }
  }

  componentDidCatch(error: Error, errorInfo: any) {
    // Log error to console in development
    if (import.meta.env.DEV) {
      console.error("Road card error:", error, errorInfo)
    }
  }

  toggleExpanded = () => {
    this.setState((prev) => ({ isExpanded: !prev.isExpanded }))
  }

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided, otherwise use default
      if (this.props.fallback) {
        return this.props.fallback
      }

      // Default error UI with collapsible details
      return (
        <div className="px-4 py-6">
          <div className="rounded-lg border border-red-200 bg-red-50 p-4">
            <div className="flex flex-col gap-3">
              {/* Header - always visible */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-red-600">
                  <Icon icon="icon-[ph--warning]" className="text-icon-lg" />
                  <span className="font-semibold">Failed to load data</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={this.toggleExpanded}
                  className="h-7 px-2 text-red-700 hover:text-red-900"
                >
                  <Icon
                    icon={this.state.isExpanded ? "icon-[ph--caret-up]" : "icon-[ph--caret-down]"}
                    className="text-icon-sm"
                  />
                </Button>
              </div>

              {/* Collapsible error details */}
              {this.state.isExpanded && (
                <div className="mt-2 pt-3 border-t border-red-200">
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium text-red-800">Error Details:</p>
                    <p className="text-xs text-red-700 font-mono bg-red-100 p-2 rounded break-words">
                      {this.state.error?.message || "An unexpected error occurred"}
                    </p>
                    {this.state.error?.stack && (
                      <details className="text-xs text-red-600">
                        <summary className="cursor-pointer hover:text-red-800 font-medium">
                          Stack Trace
                        </summary>
                        <pre className="mt-2 p-2 bg-red-100 rounded text-xs overflow-auto max-h-40 font-mono">
                          {this.state.error.stack}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

