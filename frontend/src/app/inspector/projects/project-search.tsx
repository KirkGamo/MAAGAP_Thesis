"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";

/** Search across an Inspector's assigned projects. URL-param driven like
 * every other filter in this app, and only rendered once the list is long
 * enough to need it. */
export function ProjectSearch() {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <Input
      placeholder="Search your projects..."
      defaultValue={searchParams.get("q") ?? ""}
      onChange={(e) => {
        const next = new URLSearchParams(searchParams.toString());
        if (e.target.value) next.set("q", e.target.value);
        else next.delete("q");
        router.replace(`/inspector/projects?${next.toString()}`, { scroll: false });
      }}
      className="h-12 text-base"
    />
  );
}
