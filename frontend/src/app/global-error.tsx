"use client";

/**
 * Last resort: catches errors in the root layout itself, which a route-level
 * error.tsx cannot — at that point the layout has failed, so this must render
 * its own <html> and <body> and cannot rely on any shared component or styling
 * from the app shell.
 *
 * Deliberately plain for that reason. If this is ever seen, something is wrong
 * well below the page being visited.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          margin: 0,
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <main style={{ maxWidth: "32rem", padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>MAAGAP could not start</h1>
          <p style={{ fontSize: "0.875rem", color: "#475569", lineHeight: 1.6 }}>
            The application failed to load. This is not a problem with the page you were
            visiting — please try again, and if it persists, report it with the reference below.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "1.25rem",
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              border: "1px solid #cbd5e1",
              background: "#fff",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ marginTop: "1rem", fontSize: "0.75rem", color: "#94a3b8" }}>
              Reference <code>{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
