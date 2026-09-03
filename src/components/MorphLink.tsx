"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { morphNavigate } from "@/lib/view-transition";

type MorphLinkProps = ComponentProps<typeof Link> & {
  // Shared name between this element and a block on the destination page
  // (see that page's <main viewTransitionName=...>) — the browser morphs
  // this element's box into that one instead of a plain crossfade. Give
  // every distinct destination its own name; the same name must never
  // appear on two elements on screen at once.
  viewTransitionName?: string;
};

export default function MorphLink({ href, viewTransitionName, style, onClick, ...rest }: MorphLinkProps) {
  const router = useRouter();

  return (
    <Link
      href={href}
      style={viewTransitionName ? { ...style, viewTransitionName } : style}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        e.preventDefault();
        morphNavigate(router, href.toString());
      }}
      {...rest}
    />
  );
}
