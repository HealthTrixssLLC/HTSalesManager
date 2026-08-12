import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building2, ArrowLeft, CheckCircle2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail]       = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Fetch CSRF token first
      const csrfRes  = await fetch("/api/csrf-token", { credentials: "include" });
      const { csrfToken } = await csrfRes.json() as { csrfToken: string };

      const res = await fetch("/api/auth/forgot-password", {
        method:  "POST",
        credentials: "include",
        headers: {
          "Content-Type":  "application/json",
          "X-CSRF-Token":  csrfToken,
        },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? "Something went wrong. Please try again.");
      } else {
        setSubmitted(true);
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
          <div className="p-3 rounded-xl inline-flex" style={{ background: "rgba(254,160,2,0.18)" }}>
            <Building2 className="h-8 w-8" style={{ color: "hsl(39,99%,65%)" }} />
          </div>
          <h2 className="text-3xl font-semibold leading-tight">
            Forgot your<br />password?
          </h2>
          <p className="text-white/70 text-base leading-relaxed max-w-xs">
            Enter your email address and we'll send you a secure link to reset it.
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

          {submitted ? (
            /* ── Success state ── */
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <CheckCircle2 className="h-14 w-14 text-green-500" />
              </div>
              <h1 className="text-2xl font-semibold text-foreground">Check your email</h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                If <strong>{email}</strong> is registered with a password account, you'll receive a
                reset link shortly. Check your spam folder if it doesn't arrive within a few minutes.
              </p>
              <Link href="/auth">
                <Button variant="outline" className="mt-4 gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Back to sign in
                </Button>
              </Link>
            </div>
          ) : (
            /* ── Request form ── */
            <>
              <div className="mb-7">
                <h1 className="text-2xl font-semibold text-foreground mb-1">Reset password</h1>
                <p className="text-sm text-muted-foreground">
                  Enter your email and we'll send you a reset link.
                </p>
              </div>

              {error && (
                <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="reset-email" className="text-sm font-medium">Email address</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    data-testid="input-forgot-email"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading}
                  data-testid="button-forgot-submit"
                >
                  {loading ? "Sending…" : "Send reset link"}
                </Button>
              </form>

              <p className="mt-5 text-center text-sm text-muted-foreground">
                Remember your password?{" "}
                <Link href="/auth" className="font-medium underline underline-offset-4 hover:text-foreground">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
