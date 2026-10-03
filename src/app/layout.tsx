import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { Activity } from "lucide-react";
import "./globals.css";
import { PhotonCallback } from "@/components/PhotonCallback";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Demographarma",
  description: "Patient-matched hypertension prescribing: visit capture, ranked medications, Photon e-prescribing.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-600 text-white">
                <Activity size={16} />
              </span>
              Demographarma
            </Link>
            <nav className="flex items-center gap-4 text-sm text-slate-600">
              <Link href="/" className="hover:text-ink">Visits</Link>
              <Link href="/patients" className="hover:text-ink">Patients</Link>
              <Link href="/visits/new" className="hover:text-ink">New visit</Link>
            </nav>
            <span className="ml-auto hidden text-xs text-slate-500 sm:block">Hypertension demo · clinician decision support</span>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <PhotonCallback
          clientId={process.env.NEXT_PUBLIC_PHOTON_CLIENT_ID}
          orgId={process.env.NEXT_PUBLIC_PHOTON_ORG_ID}
          devMode={(process.env.PHOTON_ENV ?? "neutron") === "neutron"}
        />
      </body>
    </html>
  );
}
