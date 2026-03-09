import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "OpenHarness Demo",
  description: "AI SDK 5 + OpenHarness chat demo",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
