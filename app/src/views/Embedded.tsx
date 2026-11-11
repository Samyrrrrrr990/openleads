import { useState } from "react";

import { PageHeader } from "~/components/shell/PageHeader";
import type { Section } from "~/components/shell/sections";
import { Spinner } from "~/components/ui/spinner";

/**
 * A screen the app hasn't rebuilt yet (the workflow editor, compose, import...), shown
 * from the classic dashboard inside the app's shell. Same server, same data; the classic
 * page hides its own sidebar when it's embedded and follows the app's theme.
 */
export function Embedded({ section, page, path, label }: { section: Section; page?: string; path: string; label: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      <PageHeader section={section} page={page} />
      <div className="relative min-h-0 flex-1">
        {!loaded && (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">
            <Spinner />
          </div>
        )}
        <iframe
          key={path}
          title={label}
          src={`/classic/?embed=1#/${path}`}
          onLoad={() => setLoaded(true)}
          className="absolute inset-0 size-full border-0 bg-background"
        />
      </div>
    </>
  );
}
