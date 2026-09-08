"use client";

import type { HTMLAttributes, ReactNode, Ref } from "react";
import { mediaFrameStyle } from "@/lib/format";

type Props = {
  aspect: string;
  maxHeight?: string;
  frameRef?: Ref<HTMLDivElement>;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">;

export function MediaFrame({
  aspect,
  maxHeight = "75vh",
  frameRef,
  className = "",
  children,
  style,
  ...rest
}: Props) {
  return (
    <div className="flex w-full justify-center bg-black">
      <div
        ref={frameRef}
        className={`relative overflow-hidden bg-black ${className}`}
        style={{ ...mediaFrameStyle(aspect, maxHeight), ...style }}
        {...rest}
      >
        {children}
      </div>
    </div>
  );
}
