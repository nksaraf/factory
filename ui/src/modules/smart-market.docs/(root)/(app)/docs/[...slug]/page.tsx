import { MDXProvider } from "@mdx-js/react"
import React, { Suspense } from "react"
import { useLocation, useParams } from "react-router"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@rio.js/ui/accordion"
// Feedback
import { Alert, AlertDescription, AlertTitle } from "@rio.js/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@rio.js/ui/alert-dialog"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@rio.js/ui/breadcrumb"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@rio.js/ui/components/avatar"
// Data display
import { Badge } from "@rio.js/ui/components/badge"
// Buttons
import { Button } from "@rio.js/ui/components/button"
import {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
} from "@rio.js/ui/components/button-group"
// Layout
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@rio.js/ui/components/card"
import { Checkbox } from "@rio.js/ui/components/checkbox"
// Dialogs
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@rio.js/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@rio.js/ui/components/dropdown-menu"
// Inputs
import { Input } from "@rio.js/ui/components/input"
import { Label } from "@rio.js/ui/components/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@rio.js/ui/components/popover"
import { ScrollArea } from "@rio.js/ui/components/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rio.js/ui/components/select"
import { Separator } from "@rio.js/ui/components/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@rio.js/ui/components/sheet"
import { Skeleton } from "@rio.js/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rio.js/ui/components/table"
// Navigation
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@rio.js/ui/components/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@rio.js/ui/components/tooltip"
import { Progress } from "@rio.js/ui/progress"
import { RadioGroup, RadioGroupItem } from "@rio.js/ui/radio-group"
import { Slider } from "@rio.js/ui/slider"
import { Switch } from "@rio.js/ui/switch"
import { Textarea } from "@rio.js/ui/textarea"

import {
  CodeBlock,
  ComponentPreview,
  PropsTable,
  VariantGrid,
} from "../../../../components/component-preview"
import {
  MdxA,
  MdxH1,
  MdxH2,
  MdxH3,
  MdxHr,
  MdxInlineCode,
  MdxLi,
  MdxP,
  MdxPre,
  MdxStrong,
  MdxTable,
  MdxTd,
  MdxTh,
  MdxThead,
  MdxTr,
  MdxUl,
} from "../../../../components/mdx-components"

const pages = import.meta.glob("../../../../content/**/*.{md,mdx}", {
  query: {},
})

const components = Object.fromEntries(
  Object.entries(pages).map(([path, loader]) => {
    const slug = path
      .replace("../../../../content/", "")
      .replace(/\.(mdx|md)$/, "")
    return [
      slug,
      React.lazy(() => loader() as Promise<{ default: React.ComponentType }>),
    ]
  })
)

const mdxComponents = {
  // Buttons
  Button,
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
  // Inputs
  Input,
  Textarea,
  Label,
  Checkbox,
  Switch,
  Slider,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  // Data display
  Badge,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Skeleton,
  Progress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  // Dialogs
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  // Feedback
  Alert,
  AlertDescription,
  AlertTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  // Layout
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Separator,
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  ScrollArea,
  // Navigation
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  // Custom components
  ComponentPreview,
  VariantGrid,
  CodeBlock,
  PropsTable,
  // HTML element overrides
  h1: MdxH1,
  h2: MdxH2,
  h3: MdxH3,
  p: MdxP,
  ul: MdxUl,
  li: MdxLi,
  code: MdxInlineCode,
  pre: MdxPre,
  table: MdxTable,
  thead: MdxThead,
  th: MdxTh,
  td: MdxTd,
  tr: MdxTr,
  hr: MdxHr,
  strong: MdxStrong,
  a: MdxA,
}

export default function DocSlugPage() {
  const params = useParams()
  const location = useLocation()
  // Extract slug from URL pathname since :slug* only captures first segment
  const slug =
    location.pathname.replace(/^\/docs\//, "").replace(/\/$/, "") ||
    params.slug ||
    params["*"] ||
    ""

  const Component = components[slug]

  if (!Component) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-scale-100 dark:bg-scale-800">
          <span className="icon-[ph--file-dashed-duotone] text-3xl text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">
          Page not found
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          No documentation found for{" "}
          <code className="rounded bg-scale-100 px-1.5 py-0.5 text-xs font-medium dark:bg-scale-800">
            {slug}
          </code>
        </p>
      </div>
    )
  }

  return (
    <MDXProvider components={mdxComponents}>
      <Suspense
        fallback={
          <div className="animate-pulse space-y-6">
            <div className="h-9 w-64 rounded-lg bg-scale-100 dark:bg-scale-800" />
            <div className="h-4 w-full rounded bg-scale-100 dark:bg-scale-800" />
            <div className="h-4 w-3/4 rounded bg-scale-100 dark:bg-scale-800" />
            <div className="mt-8 h-32 w-full rounded-xl bg-scale-100 dark:bg-scale-800" />
          </div>
        }
      >
        <Component />
      </Suspense>
    </MDXProvider>
  )
}
