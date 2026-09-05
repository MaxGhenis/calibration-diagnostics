"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useQualityContext } from "./quality-context";

export function QualityLink({ href, ...props }: ComponentProps<typeof Link>) {
  const context = useQualityContext();
  return (
    <Link
      href={typeof href === "string" ? context.href(href) : href}
      {...props}
    />
  );
}
