import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { LibraryView } from "@/components/library-view";

export const metadata: Metadata = {
  title: "Library — Lumen Enhance",
};

export default function LibraryPage() {
  return (
    <div className="relative mx-auto min-h-screen w-full max-w-[1440px] overflow-x-hidden px-5 pb-16 pt-6 md:px-8">
      <AppHeader />
      <LibraryView />
    </div>
  );
}
