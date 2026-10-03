import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PhotonCallback } from "@/components/PhotonCallback";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Volution",
  description: "Patient-matched hypertension prescribing: visit capture, ranked medications, Photon e-prescribing.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
            <Link href="/" aria-label="Volution home" className="flex items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/volution-wordmark.png" alt="Volution" className="h-8 w-auto" />
            </Link>
            <nav className="flex items-center gap-4 text-sm text-slate-600">
              <Link href="/" className="hover:text-ink">Visits</Link>
              <Link href="/patients" className="hover:text-ink">Patients</Link>
              <Link href="/visits/new" className="hover:text-ink">New visit</Link>
              <Link href="/settings" className="hover:text-ink">Settings</Link>
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
