import { Check, CircleAlert } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

type AlertProps = React.ComponentProps<"div"> & {
  tone?: "error" | "success";
  // "banner" is the standalone error block; "callout" is the single-line note that sits inside a
  // card.
  kind?: "banner" | "callout";
};

// The caller passes the role, because only it knows whether this instance is an error
// (role="alert") or a success callout (role="status").
export function Alert({
  className,
  tone = "error",
  kind = "banner",
  children,
  ...props
}: AlertProps) {
  const Icon = tone === "error" ? CircleAlert : Check;

  return (
    <div
      data-slot="alert"
      className={cn(
        "flex rounded-lg",
        tone === "error"
          ? "border border-accent-300 bg-accent-100 text-accent-900"
          : "bg-accent2-100 text-accent2-900",
        kind === "banner"
          ? "items-start gap-3 px-4 py-4 sm:gap-4 sm:px-6"
          : "flex-wrap items-center gap-x-3 gap-y-1.5 py-2 pr-2 pl-4",
        className,
      )}
      {...props}
    >
      <Icon
        aria-hidden
        strokeWidth={2.75}
        className={cn("shrink-0", kind === "banner" ? "mt-px size-[22px]" : "size-4")}
      />
      {kind === "banner" ? (
        <div className="flex min-w-0 flex-1 flex-col gap-3">{children}</div>
      ) : (
        children
      )}
    </div>
  );
}

export function AlertTitle({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("type-body-lg font-bold", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("type-body", className)} {...props} />;
}

export function AlertActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap items-center gap-3", className)} {...props} />;
}
