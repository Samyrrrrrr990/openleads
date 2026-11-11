import { type CxOptions, cx } from "class-variance-authority";
import { extendTailwindMerge } from "tailwind-merge";

// Extra font sizes are registered so tailwind-merge doesn't read text-2xs as a colour.
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["2xs", "3xs"] } },
});

export function cn(...inputs: CxOptions) {
  return twMerge(cx(inputs));
}

export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export const IS_MAC = typeof navigator !== "undefined" && isMacPlatform(navigator.platform || "");
