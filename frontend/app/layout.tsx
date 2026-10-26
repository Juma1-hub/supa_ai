import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Supa AI | Trading Intelligence",
  description: "Supa AI strategy workspace with secure Deriv account authorization.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
