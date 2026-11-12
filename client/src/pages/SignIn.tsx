import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, LogIn } from "lucide-react";
import { KubeDeckLogo } from "@/components/KubeDeckLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn } from "@/hooks/use-admin";
import { MODE_KEY } from "@/hooks/use-server-mode";

/** KubeDeck's own sign-in (KUBEDECK_AUTH=builtin). Accounts are created by an admin; there is no sign-up. */
export function SignInPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const problem = await signIn(email.trim(), password);
      if (problem) {
        setError(problem);
        return;
      }
      // nothing cached before sign-in belongs to this user
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== MODE_KEY[0] });
      await qc.invalidateQueries({ queryKey: MODE_KEY });
    } catch {
      setError("KubeDeck could not be reached. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <KubeDeckLogo size="lg" />
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm" aria-describedby={error ? "sign-in-error" : undefined}>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 text-xs text-muted-foreground">Use the account your KubeDeck admin created for you.</p>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Email</span>
            <Input id="sign-in-email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">Password</span>
            <Input id="sign-in-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && (
            <p id="sign-in-error" role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Sign in
          </Button>
        </form>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">Forgot your password? A KubeDeck admin can set a new one.</p>
      </div>
    </main>
  );
}
