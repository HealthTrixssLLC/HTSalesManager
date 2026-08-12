import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, AlertCircle } from "lucide-react";

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [token, setToken]             = useState<string | null>(null);
  const [password, setPassword]       = useState("");
  const [confirm, setConfirm]         = useState("");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [success, setSuccess]         = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (!t) {
      setError("No reset token found. Please request a new password reset link.");
    } else {
      setToken(t);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const csrfRes = await fetch("/api/csrf-token", { credentials: "include" });
      const { csrfToken } = await csrfRes.json() as { csrfToken: string };

      const res = await fetch("/api/auth/reset-password", {
        method:  "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ token, newPassword: password }),
      });

      const data = await res.json().catch(() => ({})) as { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Failed to reset password. Please try again.");
      } else {
        setSuccess(true);
        toast({ title: "Password updated", description: "You can now sign in with your new password." });
        setTimeout(() => setLocation("/auth"), 2500);
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Left panel */}
      <div
        className="hidden lg:flex flex-1 flex-col justify-between p-12 text-white"
        style={{ background: "linear-gradient(160deg, hsl(216,42%,18%) 0%, hsl(216,40%,22%) 55%, hsl(216,38%,28%) 100%)" }}
      >
        <div className="flex items-center gap-3">
          <img
            src="/ht-logo.png"
            alt="Health Trixss"
            className="h-10 w-10 rounded-md shrink-0 object-contain bg-white"
          />
          <div>
            <p className="font-semibold text-white text-sm leading-none">Health Trixss</p>
            <p className="text-white/50 text-xs mt-0.5">Healthcare Innovation &amp; Analytics</p>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-3xl font-semibold leading-tight">
            Set your<br />new password
          </h2>
          <p className="text-white/70 text-base leading-relaxed max-w-xs">
            Choose a strong password with at least 8 characters.
          </p>
        </div>

        <p className="text-white/30 text-xs">
          &copy; {new Date().getFullYear()} Health Trixss, Inc.
        </p>
      </div>

      {/* Right panel */}
      <div className="flex flex-1 items-center justify-center p-8 bg-background">
        <div className="w-full max-w-sm">
          {/* Mobile wordmark */}
          <div className="flex lg:hidden items-center gap-3 mb-8">
            <img
              src="/ht-logo.png"
              alt="Health Trixss"
              className="h-9 w-9 rounded-md shrink-0 object-contain"
              style={{ background: "hsl(216, 40%, 22%)", padding: "4px" }}
            />
            <p className="font-semibold text-foreground">Health Trixss CRM</p>
          </div>

          {success ? (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <CheckCircle2 className="h-14 w-14 text-green-500" />
              </div>
              <h1 className="text-2xl font-semibold text-foreground">Password updated!</h1>
              <p className="text-sm text-muted-foreground">
                Redirecting you to sign in…
              </p>
            </div>
          ) : (
            <>
              <div className="mb-7">
                <h1 className="text-2xl font-semibold text-foreground mb-1">Set new password</h1>
                <p className="text-sm text-muted-foreground">
                  Enter and confirm your new password below.
                </p>
              </div>

              {error && (
                <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 flex gap-2 items-start">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-destructive">{error}</p>
                    {(error.includes("expired") || error.includes("invalid") || error.includes("No reset token")) && (
                      <Link href="/forgot-password" className="text-sm font-medium underline underline-offset-4 text-destructive mt-1 inline-block">
                        Request a new link
                      </Link>
                    )}
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="new-password" className="text-sm font-medium">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="Min. 8 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    disabled={!token}
                    autoFocus
                    data-testid="input-new-password"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password" className="text-sm font-medium">Confirm password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="Re-enter your password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    disabled={!token}
                    data-testid="input-confirm-password"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading || !token}
                  data-testid="button-reset-submit"
                >
                  {loading ? "Updating…" : "Update password"}
                </Button>
              </form>

              <p className="mt-5 text-center text-sm text-muted-foreground">
                <Link href="/auth" className="font-medium underline underline-offset-4 hover:text-foreground">
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
