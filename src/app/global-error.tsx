"use client";

/*
 * Replaces the root layout when it fails, so it can't rely on globals.css, fonts or the
 * theme provider. Styles are inline and follow the OS color scheme.
 */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          colorScheme: "light dark",
          padding: "1rem",
          textAlign: "center",
        }}
      >
        <title>Something went wrong | Reserve-A-Room</title>
        <div style={{ maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.5rem" }}>Something went wrong</h1>
          <p>Reserve-A-Room couldn&apos;t load. Please try again in a moment.</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: "1rem",
              minHeight: "2.75rem",
              padding: "0 1.25rem",
              borderRadius: "0.6rem",
              border: "none",
              background: "#031e47",
              color: "#fff",
              fontSize: "1rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
