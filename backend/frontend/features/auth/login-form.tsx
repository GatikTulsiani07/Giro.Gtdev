"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, KeyRound, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TokenInput } from "@/components/ui/token-input";
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
    <form onSubmit={submit} className="mt-7" noValidate>
      <div>
        <label htmlFor="access-token" className="mb-2 block type-compact-strong text-text-secondary">Giro access token</label>
        <div className="relative">
          <KeyRound className="absolute left-3 top-3 size-4 text-muted-foreground" strokeWidth={1.5} />
          <TokenInput
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
        {error ? <p id="login-error" role="alert" className="mt-2 type-compact text-danger">{error}</p> : (
          <p id="login-help" className="mt-2 type-compact text-muted-foreground">Authentication is validated before the workspace opens.</p>
        )}
      </div>
      <Button variant="accent" className="mt-6 w-full" disabled={loading}>
        {loading ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <ArrowRight className="size-4" />}
        {loading ? "Verifying…" : "Enter workspace"}
      </Button>
    </form>
  );
}
