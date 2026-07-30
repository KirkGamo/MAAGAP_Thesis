"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Phase 21: the Project column got a fixed width so the table's column
 * widths stop shifting row-to-row with project-name length -- but a fixed
 * width means long names truncate. Rather than just an ellipsis (which
 * hides the rest of the name permanently), this reveals the full text on
 * hover by sliding it left exactly as far as it's clipped
 * (`scrollWidth - clientWidth`, measured via a ref rather than guessed),
 * then slides back on mouse-leave. No infinite-loop marquee/duplicate-text
 * trick -- for a data table cell, "slide to reveal, slide back" reads as
 * an intentional affordance; a looping marquee would be distracting on a
 * page with 15+ rows of it happening at once.
 */
export function MarqueeText({ text, className }: { text: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    function measure() {
      if (!containerRef.current || !textRef.current) return;
      setDistance(Math.max(0, textRef.current.scrollWidth - containerRef.current.clientWidth));
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [text]);

  return (
    <div
      ref={containerRef}
      className={cn("overflow-hidden whitespace-nowrap", className)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        ref={textRef}
        className="inline-block transition-transform duration-[1400ms] ease-in-out"
        style={{ transform: hovered && distance > 0 ? `translateX(-${distance}px)` : "translateX(0)" }}
      >
        {text}
      </span>
    </div>
  );
}
