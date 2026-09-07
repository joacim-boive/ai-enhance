import type { Metadata } from "next";
import { Fraunces, Geist_Mono, Syne } from "next/font/google";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const preferredRegion = "fra1";

export const metadata: Metadata = {
  title: "Lumen Enhance — studio-grade video restoration",
  description:
    "Upscale footage and lift frame rate with live processing feedback. GPU SeedVR2 + RIFE, with a graceful CPU fallback.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${syne.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="grain" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
