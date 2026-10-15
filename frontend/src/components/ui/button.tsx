// Adapted from the official shadcn/ui new-york-v4 registry. MIT licensed.
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] text-[13px] font-medium tracking-[-0.005em] whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[var(--ease-out)] outline-none active:translate-y-px focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[inset_0_1px_0_var(--button-sheen),inset_0_-1px_0_color-mix(in_srgb,var(--shadow-color)_14%,transparent),0_1px_2px_color-mix(in_srgb,var(--shadow-color)_25%,transparent),0_4px_14px_-6px_var(--brand-glow)] hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/40",
        outline:
          "border border-[var(--line)] bg-[color-mix(in_srgb,var(--card)_75%,transparent)] shadow-[var(--elevation-1)] hover:border-border hover:bg-accent hover:text-accent-foreground",
        secondary:
          "border border-[var(--line)] bg-secondary text-secondary-foreground shadow-[var(--elevation-1)] hover:bg-accent",
        ghost:
          "text-muted-foreground hover:bg-[color-mix(in_srgb,var(--accent)_70%,transparent)] hover:text-foreground",
        link: "text-[var(--brand-ink)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-[12.5px] has-[>svg]:px-2.5",
        lg: "h-10 px-6 text-sm has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
