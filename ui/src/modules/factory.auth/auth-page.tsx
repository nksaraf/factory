import { useLocation } from "react-router"

import { useApp } from "@rio.js/app-ui/hooks/use-app"
import { useAuth } from "@rio.js/auth-ui/components/auth-provider"
import { AuthView } from "@rio.js/auth-ui/components/auth/auth-view"

export default function AuthPage() {
  const { redirectTo } = useAuth()
  const { pathname } = useLocation()
  const app = useApp()

  return (
    <div className="flex flex-col grow size-full items-center justify-center gap-3">
      <AuthView
        pathname={pathname}
        redirectTo={redirectTo}
        classNames={{
          backgroundImage: app.backgroundImage ?? "/map.webp",
          description: "text-center",
          title: "text-center",
          form: {
            input: "rounded-full h-8 px-4",
            button: "rounded-full h-8",
            label: "ml-1",
            base: "m-0 gap-4",
            description: "text-center",
          },
        }}
      />
    </div>
  )
}
