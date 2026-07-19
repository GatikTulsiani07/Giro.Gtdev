import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PlatformNavigation } from "@/components/platform/platform-navigation";
import { PublicBrand } from "@/components/marketing/public-brand";
import { Button } from "@/components/ui/button";

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border-subtle bg-background">
      <div className="mx-auto flex min-h-[64px] w-full max-w-[1280px] flex-wrap items-center gap-x-5 gap-y-2 px-12 py-3 max-[1080px]:px-8 max-[820px]:px-4">
        <PublicBrand />
        <div className="order-3 w-full overflow-x-auto desktop:order-none desktop:ml-auto desktop:w-auto"><div className="min-w-max"><PlatformNavigation /></div></div>
        <Button asChild variant="secondary" size="sm" className="ml-auto desktop:ml-3"><Link href="/login">Sign in<ArrowRight className="size-3.5" /></Link></Button>
      </div>
    </header>
  );
}
