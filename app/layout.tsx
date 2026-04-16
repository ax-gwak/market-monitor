import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Market Monitor",
  description: "Integrated market cycle & band monitor",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
