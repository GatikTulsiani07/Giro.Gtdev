"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { sessionsApi } from "@/services/api/sessions";

const TOKEN_KEY = "giro.access-token";

interface AuthContextValue {
  token: string | null;
  ready: boolean;
  signIn(token: string): Promise<void>;
  signOut(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const signOut = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    setToken(sessionStorage.getItem(TOKEN_KEY));
    setReady(true);
  }, []);

  useEffect(() => {
    window.addEventListener("giro:unauthorized", signOut);
    return () => window.removeEventListener("giro:unauthorized", signOut);
  }, [signOut]);

  useEffect(() => {
    if (!ready) return;
    if (!token && pathname !== "/login") router.replace("/login");
    if (token && pathname === "/login") router.replace("/dashboard");
  }, [pathname, ready, router, token]);

  const signIn = useCallback(async (candidate: string) => {
    const clean = candidate.trim();
    await sessionsApi.list(clean);
    sessionStorage.setItem(TOKEN_KEY, clean);
    setToken(clean);
    router.replace("/dashboard");
  }, [router]);

  const value = useMemo(() => ({ token, ready, signIn, signOut }), [ready, signIn, signOut, token]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const { ready, token } = useAuth();
  if (!ready || !token) {
    return (
      <div className="grid min-h-screen place-items-center bg-background" aria-label="Loading authentication">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary motion-reduce:animate-none" />
      </div>
    );
  }
  return children;
}
