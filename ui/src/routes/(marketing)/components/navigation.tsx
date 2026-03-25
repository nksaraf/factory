import { Link } from "react-router"

import { AppLogo } from "@rio.js/app-ui/components/app-logo"
import { AppName } from "@rio.js/app-ui/components/app-name"
import { Button } from "@rio.js/ui/button"

export function Navigation() {
  const navItems = ["Features", "Use Cases", "Data", "Integration", "Contact"]

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-scale-500 bg-scale-100 backdrop-blur supports-[backdrop-filter]:bg-scale-100/80">
      <div className="container mx-auto flex h-16 items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <AppLogo />
          <AppName />
        </div>

        <div className="hidden items-center gap-6 lg:flex">
          {navItems.slice(0, 5).map((item) => (
            <a
              key={item}
              href={`#${item.toLowerCase().replace(/\s+/g, "-")}`}
              className="text-sm font-medium text-scale-1000 hover:text-scale-1200 transition-colors"
            >
              {item}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="text-scale-1000 hover:text-scale-1200"
          >
            <Link to="/auth/sign-in">Sign In</Link>
          </Button>
          <Button
            variant="default"
            size="sm"
            asChild
            className="bg-teal-600 text-scale-100 hover:bg-teal-700"
          >
            <Link to="/auth/sign-up">Get Started</Link>
          </Button>
        </div>
      </div>
    </nav>
  )
}
