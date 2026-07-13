export const metadata = {
  title: "Pitantir",
  description: "Track historically significant Minecraft books",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "1.5rem" }}>
        <header style={{ marginBottom: "1.5rem" }}>
          <strong>
            <a href="/" style={{ color: "inherit", textDecoration: "none" }}>
              Pitantir
            </a>
          </strong>
          <nav style={{ marginTop: "0.5rem" }}>
            <a href="/search" style={{ marginRight: "1rem" }}>
              Item search
            </a>
            <a href="/accounts" style={{ marginRight: "1rem" }}>
              Accounts
            </a>
            <a href="/items" style={{ marginRight: "1rem" }}>
              Items
            </a>
            <a href="/scans" style={{ marginRight: "1rem" }}>
              Scans
            </a>
            <a href="/settings">Settings</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
