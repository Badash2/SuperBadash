import type { Metadata } from "next";
import Kiosk from "@/components/Kiosk";

export const metadata: Metadata = { title: "SuperBadash · סורק" };

// The fixed scanner by the bin. Client-only, like the rest of the app (the security is RLS in Supabase).
export default function ScannerPage() {
  return <Kiosk />;
}
