import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

const heebo = Heebo({ subsets: ["hebrew", "latin"], variable: "--font-heebo", display: "swap" });
import { RegisterSW } from "@/components/RegisterSW";

export const metadata: Metadata = {
  title: "SuperBadash",
  description: "רשימת הקניות החכמה של משפחת בדש: מחירים, מבצעים אמיתיים והשוואה בין הסופרים בנתניה",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "SuperBadash", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1310" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
