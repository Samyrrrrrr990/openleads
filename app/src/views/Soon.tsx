import { ArrowUpRightIcon } from "lucide-react";

import { Body } from "~/components/app/bits";
import { PageHeader } from "~/components/shell/PageHeader";
import type { Section } from "~/components/shell/sections";
import { Button } from "~/components/ui/button";
import { classic } from "~/lib/router";

/** A screen the app doesn't have yet: say so and open it in the classic dashboard. */
export function Soon({ section, page, label, classicPath }: { section: Section; page?: string; label: string; classicPath: string }) {
  return (
    <>
      <PageHeader section={section} page={page} />
      <Body>
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <p className="text-[15px] font-medium">{label} lives in the classic dashboard for now.</p>
          <p className="mt-1 text-[13px] text-muted-foreground">Same data, same server. It opens in this tab.</p>
          <Button className="mt-4" variant="outline" render={<a href={classic(classicPath)} />}>
            Open {label.toLowerCase()} <ArrowUpRightIcon />
          </Button>
        </div>
      </Body>
    </>
  );
}
