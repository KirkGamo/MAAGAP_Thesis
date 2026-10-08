import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * The shared page header for the manager portal.
 *
 * This encodes a convention the portal already follows without exception, but
 * which lived nowhere except in six copies of the same markup. Auditing it
 * found the correlation to be exact:
 *
 *   pinned pages (Schedule, Inspectors, Reports)   -> text-xl  / text-xs
 *   scrolling pages (PPAs, Models, Import)         -> text-2xl / text-sm
 *
 * It is not styling drift. A page pinned to 100dvh is spending a fixed height
 * budget, so its header is compact; a page that scrolls can afford a roomier
 * one. Nothing recorded that, so the next page added had a coin-flip chance of
 * getting it right, and a header one step too large on a pinned page costs the
 * content below it real space.
 *
 * `density` therefore names the reason rather than the size: pass "compact"
 * when the page is pinned, "default" when it scrolls.
 *
 * The default wrapper stacks below sm. That is not cosmetic either -- as a
 * single non-wrapping flex row it put the action group beside the title at
 * every width and pushed the PPAs page 15px past a 390px viewport.
 */
export function PageHeader({
  title,
  description,
  icon: Icon,
  density = "default",
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** The page's nav icon. Comes from manager/nav-items.ts so the header and
   * the sidebar always agree; decorative, since the h1 beside it is the name. */
  icon?: LucideIcon;
  /** "compact" for pages pinned to the viewport; "default" for scrolling pages. */
  density?: "compact" | "default";
  /** Buttons, filters or toggles rendered opposite the title. */
  actions?: ReactNode;
}) {
  const compact = density === "compact";
  return (
    <div
      className={
        compact
          ? "flex shrink-0 flex-wrap items-start justify-between gap-x-4 gap-y-2"
          : "flex flex-col items-start gap-4 sm:flex-row sm:justify-between"
      }
    >
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon && (
          <Icon
            aria-hidden="true"
            className={compact ? "mt-1 size-5 shrink-0 text-brand-blue" : "mt-1.5 size-6 shrink-0 text-brand-blue"}
          />
        )}
        <div className="min-w-0">
        <h1
          className={
            compact
              ? "text-xl font-semibold text-brand-navy"
              : "text-2xl font-semibold text-brand-navy"
          }
        >
          {title}
        </h1>
        {description && (
          <p className={compact ? "text-xs text-ink-muted" : "text-sm text-ink-muted"}>
            {description}
          </p>
        )}
        </div>
      </div>
      {actions}
    </div>
  );
}
