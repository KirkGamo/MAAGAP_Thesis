import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
