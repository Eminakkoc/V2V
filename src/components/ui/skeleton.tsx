import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-lg bg-neutral-300 motion-safe:animate-pulse", className)}
      {...props}
    />
  )
}

export { Skeleton }
