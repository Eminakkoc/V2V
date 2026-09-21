"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react"

// Figma "Toast" (16:448): one dark surface for every tone -- cream on
// neutral-900 is 13:1, and the accent-300 action is 9.5:1 -- so the tone is
// carried by the icon rather than by the background.
//
// Pinned to "light" rather than read from next-themes: the design has a single
// light palette, so there is no theme to follow. Left unset, sonner's own
// default is "system", which would restyle toasts for OS-dark readers against
// an app that never goes dark.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-[18px]" />,
        info: <InfoIcon className="size-[18px]" />,
        warning: <TriangleAlertIcon className="size-[18px]" />,
        error: <CircleAlertIcon className="size-[18px]" />,
        loading: <Loader2Icon className="size-[18px] motion-safe:animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--color-neutral-900)",
          "--normal-text": "var(--color-bg)",
          "--normal-border": "transparent",
          "--error-bg": "var(--color-neutral-900)",
          "--error-text": "var(--color-bg)",
          "--error-border": "transparent",
          "--success-bg": "var(--color-neutral-900)",
          "--success-text": "var(--color-bg)",
          "--success-border": "transparent",
          "--border-radius": "var(--radius-lg)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast shadow-lg",
          actionButton: "!bg-transparent !text-accent-300 !font-semibold",
          closeButton: "!bg-neutral-900 !border-transparent !text-bg",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
