import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

/**
 * IBM Plex, replacing the Next.js scaffold's Geist.
 *
 * Geist went thin and washed on the navy surfaces introduced in phase 2 of
 * WEBSITE_REDESIGN_PLAN.md. Plex Sans was drawn for technical and data-dense
 * interfaces and holds its weight on a dark ground, which is the condition
 * this app now has to meet.
 *
 * The mono companion is the real reason for the pair. This app is mostly
 * figures in columns -- risk probabilities, efficiency, costs, inspector-days,
 * contrast ratios -- and Plex Mono gives them a face with true tabular figures
 * instead of borrowing the UI sans.
 *
 * Weights are declared explicitly: next/font only ships what is asked for, and
 * a missing weight falls back silently to the nearest available one rather
 * than erroring.
 */
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MAAGAP — PPDO Project Monitoring",
  description:
    "Predictive risk assessment and optimized resource allocation for Philippine government project management.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning on <html>/<body>: this is not an app bug.
    // The reported mismatch (`data-scribe-recorder-ready="true"`) is an
    // attribute a browser extension injects into the DOM after the page
    // loads but before/while React hydrates -- the exact "browser
    // extension... messes with the HTML before React loaded" case React's
    // own hydration-mismatch docs call out (https://react.dev/link/hydration-mismatch).
    // It never exists in the server-rendered HTML, so React will always
    // see a diff on <html> for as long as that extension is installed and
    // active; suppressHydrationWarning here only silences mismatches on
    // this one element's own attributes (not on any content inside
    // <body>), so a genuine hydration bug in the app itself would still
    // surface normally.
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
