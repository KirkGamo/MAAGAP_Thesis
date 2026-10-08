import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The shared empty state.
 *
 * Empty regions in this portal were bare sentences in varying voices --
 * "No monitoring reports match this filter.", "No visits scheduled for this
 * day.", "No optimizer slots yet" -- each centred differently, none offering a
 * way out. An empty state is the screen a user meets when they are already
 * unsure whether they did something wrong, so it has one job beyond saying
 * nothing is here: say what would put something here.
 *
 * `action` is optional but strongly preferred. Where there is genuinely nothing
 * to do -- a day with no visits because none were scheduled -- `hint` explains
 * instead, which is still better than a full stop.
 *
 * The icon is decorative. It gives the block a centre of gravity so an empty
 * panel reads as deliberately empty rather than as content that failed to load.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "flex flex-col items-center justify-center gap-2 px-6 py-8 text-center " + (className ?? "")
      }
    >
      {Icon && (
        <Icon aria-hidden="true" className="size-7 text-brand-navy/20" strokeWidth={1.5} />
      )}
      <p className="text-sm font-medium text-brand-navy">{title}</p>
      {hint && <p className="max-w-xs text-xs leading-relaxed text-ink-faint">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
