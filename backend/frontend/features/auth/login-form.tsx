"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, KeyRound, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "./auth-context";
import { getApiErrorMessage } from "@/services/api/client";

export function LoginForm() {
  const { signIn } = useAuth();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token.trim()) {
      setError("Enter an access token.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signIn(token);
    } catch (cause) {
      setError(getApiErrorMessage(cause));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
      <div>
        <label htmlFor="access-token" className="mb-2 block text-xs font-medium text-muted-foreground">Giro access token</label>
        <div className="relative">
          <KeyRound className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            id="access-token"
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Paste your bearer token"
            className="pl-9"
            aria-describedby={error ? "login-error" : "login-help"}
          />
        </div>
        {error ? <p id="login-error" role="alert" className="mt-2 text-xs text-red-300">{error}</p> : (
          <p id="login-help" className="mt-2 text-xs leading-relaxed text-muted-foreground">Authentication is validated by your existing Giro backend. The token is kept for this browser tab only.</p>
        )}
      </div>
      <Button className="w-full" disabled={loading}>
        {loading ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <ArrowRight className="size-4" />}
        {loading ? "Verifying…" : "Enter workspace"}
      </Button>
    </form>
  );
}
