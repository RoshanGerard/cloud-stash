"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

import { usePreference } from "@/features/theme/theme-store"

// design.md Decision 6 rejects next-themes; this wrapper reads the renderer's
// own theme store so Sonner reflects the user's explicit Light/Dark choice
// (falling back to `prefers-color-scheme` when the preference is "system").
// The preference union (`"light" | "dark" | "system"`) matches Sonner's own
// `theme` prop exactly, so it forwards unchanged — the toast chrome inherits
// the CloudStash palette through the CSS variables (`--normal-bg` →
// `var(--popover)`, etc.) below.
const Toaster = ({ ...props }: ToasterProps) => {
  const pref = usePreference()
  const theme: ToasterProps["theme"] = pref

  return (
    <Sonner
      theme={theme}
      // Keep toasts always expanded (`expand`) and cap visible stack size
      // (`visibleToasts`) — the defaults collapse the stack and pop the
      // hovered toast out, which reads as misalignment when the user
      // triggers rapid-fire actions (delete, download, rename). A
      // persistent close button lets the user dismiss lingering toasts
      // without waiting for the auto-timeout.
      expand
      visibleToasts={5}
      closeButton
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
