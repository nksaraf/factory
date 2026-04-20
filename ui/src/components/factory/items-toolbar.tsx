export function ItemsToolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="md:px-4 py-6 flex md:justify-between md:items-center container mx-auto justify-center gap-4 flex-col md:flex-row w-full">
      {children}
    </div>
  )
}
