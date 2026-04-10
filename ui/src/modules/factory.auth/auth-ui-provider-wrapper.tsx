import { useAuth } from "@rio.js/auth-ui/components/auth-provider"
import { AuthUIProvider } from "@rio.js/auth-ui/components/auth-ui-provider"

export default function AuthUIProviderWrapper({
  children,
}: {
  children: React.ReactNode
}) {
  const props = useAuth()
  return <AuthUIProvider {...props}>{children}</AuthUIProvider>
}
