"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AuthProvider } from "@/features/auth/auth-context";
import { RepositoryProvider } from "@/features/repositories/repository-context";
import { SessionProvider } from "@/features/sessions/session-context";
import { createFrontendQueryClient } from "@/services/query/query-client";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createFrontendQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RepositoryProvider>
          <SessionProvider>{children}</SessionProvider>
        </RepositoryProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
