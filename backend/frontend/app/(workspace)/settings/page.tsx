import type { Metadata } from "next";
import { PageContainer, SectionHeader, UnavailablePlaceholder } from "@/components/ui/foundation";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <PageContainer>
      <SectionHeader eyebrow="Workspace" title="Settings." description="Frontend preferences and account controls will live here." />
      <div className="mt-8"><UnavailablePlaceholder title="Workspace settings" /></div>
    </PageContainer>
  );
}
