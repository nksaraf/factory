export default function ScoutsRedirectLayout({
  children,
}: {
  children: React.ReactNode
}) {
  console.log("ScoutsRedirectLayout", children)
  return <>{children}</>
}
