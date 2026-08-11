// FILE: VeylenLogo.tsx
// Purpose: Render the Veylen mark as an inline SVG that follows theme foreground color.
// Layer: Shared app branding primitive

import type { SVGProps } from "react";
import { VEYLEN_LOGO_PATHS } from "~/assets/veylenLogoPath";
import { cn } from "~/lib/utils";

export function VeylenLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  const ariaLabel = props["aria-label"];

  return (
    <svg
      viewBox="0 0 470 504"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={ariaLabel ? undefined : true}
      {...props}
      className={cn("shrink-0 text-foreground", className)}
    >
      {VEYLEN_LOGO_PATHS.map((path) => (
        <path key={path} d={path} fill="currentColor" />
      ))}
    </svg>
  );
}
