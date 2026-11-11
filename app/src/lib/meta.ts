import { useEffect, useState } from "react";

import { api } from "./api";
import type { Meta } from "./types";

// Stage names and tones never change while the page is open: fetch once, share.
let cached: Meta | null = null;
let pending: Promise<Meta> | null = null;

export function useMeta(): Meta | null {
  const [meta, setMeta] = useState<Meta | null>(cached);
  useEffect(() => {
    if (cached) return;
    pending ??= api.get<Meta>("/api/meta");
    let live = true;
    pending
      .then((m) => {
        cached = m;
        if (live) setMeta(m);
      })
      .catch(() => {
        pending = null;
      });
    return () => {
      live = false;
    };
  }, []);
  return meta;
}
