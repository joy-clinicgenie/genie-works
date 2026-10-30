import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: { default: "Clinic Genie", template: "%s | Clinic Genie" },
  description: "Internal operations platform for Clinic Genie staff.",
  robots: { index: false, follow: false },
  icons: { icon: "/brandmark.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#DDF7F8" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={jakarta.variable}>
      <body>{children}</body>
    </html>
  );
}
