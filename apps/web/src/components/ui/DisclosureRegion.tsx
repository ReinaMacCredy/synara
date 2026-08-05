// FILE: DisclosureRegion.tsx
// Purpose: Controlled expand/collapse region with the shared sidebar-style grid animation.
// Layer: UI primitive
// Exports: DisclosureRegion
// Depends on: disclosureMotion helpers

import type { ReactNode } from "react";

import {
  DISCLOSURE_INNER_CLASS,
  type DisclosureContentOrigin,
  disclosureContentClassName,
  disclosureShellClassName,
} from "~/lib/disclosureMotion";

export function DisclosureRegion(props: {
  open: boolean;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  contentOrigin?: DisclosureContentOrigin;
}) {
  const { open, children, className, contentClassName, contentOrigin } = props;

  return (
    <div
      className={disclosureShellClassName(open, className)}
      aria-hidden={open ? undefined : true}
      inert={!open}
    >
      <div className={DISCLOSURE_INNER_CLASS}>
        <div className={disclosureContentClassName(open, contentClassName, contentOrigin)}>
          {children}
        </div>
      </div>
    </div>
  );
}
