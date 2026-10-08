"use client";

import * as Popover from "@radix-ui/react-popover";
import { HelpCircle } from "lucide-react";
import { glossary, type GlossaryKey } from "@/lib/glossary";

/**
 * A technical term with its plain-language explanation one click away.
 *
 * The terms are not renamed -- they appear in the thesis manuscript and must
 * stay consistent with Chapter 3 -- so the explanation has to reach the reader
 * some other way. Measurement found the jargon concentrated rather than spread:
 * the Models page carried 36 of 45 flagged terms and the other five pages
 * averaged two each, which is why this is a small affordance applied to a
 * handful of specific places rather than a rewrite.
 *
 * Radix Popover rather than a `title` attribute: `title` is announced
 * inconsistently by screen readers, never appears on keyboard focus, and is
 * invisible on touch -- so on a tablet in a PPDO office it explains nothing at
 * all. The popover is keyboard-operable, closes on Escape, and returns focus to
 * the trigger, which was verified for the other overlays in this app.
 *
 * The trigger carries an explicit aria-label naming the term, because
 * "help" repeated eleven times down a page tells a screen-reader user nothing
 * about which term each one belongs to.
 */
export function TermHint({
  term: key,
  children,
  className,
}: {
  term: GlossaryKey;
  /** The visible term. Defaults to the glossary's own spelling. */
  children?: React.ReactNode;
  className?: string;
}) {
  const entry = glossary(key);
  return (
    <span className={"inline-flex items-center gap-1 " + (className ?? "")}>
      {children ?? entry.term}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={`What does ${entry.term} mean?`}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-brand-navy/40 transition-colors hover:text-brand-blue focus-visible:ring-2 focus-visible:ring-brand-sky-dark focus-visible:ring-offset-1 focus-visible:outline-none"
          >
            <HelpCircle className="size-3.5" aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="start"
            sideOffset={6}
            collisionPadding={8}
            className="z-50 max-w-xs rounded-lg border border-brand-navy/10 bg-white p-3 shadow-overlay"
          >
            <p className="text-xs font-semibold text-brand-navy">{entry.term}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">{entry.plain}</p>
            {entry.soWhat && (
              <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">{entry.soWhat}</p>
            )}
            <Popover.Arrow className="fill-white" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </span>
  );
}
