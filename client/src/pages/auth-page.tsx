import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, LineChart, Users, Shield } from "lucide-react";

function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

export default function AuthPage() {
  const { user, loginMutation, registerMutation } = useAuth();
  const [, setLocation] = useLocation();

  const [loginData, setLoginData] = useState({ email: "", password: "" });
  const [registerData, setRegisterData] = useState({ email: "", name: "", password: "", confirmPassword: "" });
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);

  // Handle Entra SSO token from redirect param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const ssoErr = params.get("sso_error");

    if (token) {
      localStorage.setItem("entra_token", token);
      // Clean the URL then navigate to the app
      window.history.replaceState({}, "", "/auth");
      setLocation("/");
      return;
    }

    if (ssoErr) {
      setSsoError(decodeURIComponent(ssoErr));
      window.history.replaceState({}, "", "/auth");
    }
  }, [setLocation]);

  if (user) {
    setLocation("/");
    return null;
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(loginData);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (registerData.password !== registerData.confirmPassword) {
      setPasswordMismatch(true);
      return;
    }
    setPasswordMismatch(false);
    const { confirmPassword, ...data } = registerData;
    registerMutation.mutate(data);
  };

  const handleMicrosoftSignIn = () => {
    window.location.href = "/api/auth/entra/login";
  };

  return (
    <div className="flex min-h-screen">

      {/* Left panel — Dark Blue gradient hero */}
      <div
        className="hidden lg:flex flex-1 flex-col justify-between p-12 text-white"
        style={{ background: "linear-gradient(160deg, hsl(216,42%,18%) 0%, hsl(216,40%,22%) 55%, hsl(216,38%,28%) 100%)" }}
      >
        {/* Official H+ logo + HealthTrixss wordmark */}
        <div className="flex items-center gap-3">
          <img
            src="/ht-logo.png"
            alt="HealthTrixss"
            className="h-10 w-10 rounded-md shrink-0 object-contain bg-white"
          />
          <div>
            <p className="font-semibold text-white text-sm leading-none">HealthTrixss</p>
            <p className="text-white/50 text-xs mt-0.5">Healthcare Innovation &amp; Analytics</p>
          </div>
        </div>

        {/* Hero text */}
        <div className="space-y-10">
          <div>
            <h2 className="text-4xl font-semibold leading-tight mb-4">
              Streamline Your<br />Sales Process
            </h2>
            <p className="text-white/70 text-lg leading-relaxed max-w-sm">
              A powerful, self-hosted CRM designed for healthcare professionals.
              Manage leads, track opportunities, and close deals faster.
            </p>
          </div>

          <div className="space-y-5">
            {[
              { icon: Building2, title: "Account Management",   desc: "Organize all your customer accounts in one place" },
              { icon: LineChart,  title: "Pipeline Insights",    desc: "Visualize your sales pipeline and track progress" },
              { icon: Users,      title: "Team Collaboration",   desc: "Work together with role-based access control" },
              { icon: Shield,     title: "Enterprise Security",  desc: "Self-hosted with full audit trails and backups" },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex gap-4 items-start">
                <div className="p-2.5 rounded-lg shrink-0" style={{ background: "rgba(254,160,2,0.18)" }}>
                  <Icon className="h-5 w-5" style={{ color: "hsl(39,99%,65%)" }} />
                </div>
                <div>
                  <p className="font-medium text-white text-sm leading-none mb-1">{title}</p>
                  <p className="text-white/55 text-sm">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="text-white/30 text-xs">
          &copy; {new Date().getFullYear()} HealthTrixss. Self-hosted &amp; secure.
        </p>
      </div>

      {/* Right panel — white form */}
      <div className="flex flex-1 items-center justify-center p-8 bg-background">
        <div className="w-full max-w-sm">

          {/* Mobile-only wordmark */}
          <div className="flex lg:hidden items-center gap-3 mb-8">
            <img
              src="/ht-logo.png"
              alt="HealthTrixss"
              className="h-9 w-9 rounded-md shrink-0 object-contain"
              style={{ background: "hsl(216, 40%, 22%)", padding: "4px" }}
            />
            <p className="font-semibold text-foreground">HealthTrixss CRM</p>
          </div>

          <div className="mb-7">
            <h1 className="text-2xl font-semibold text-foreground mb-1">Welcome back</h1>
            <p className="text-sm text-muted-foreground">Sign in to your CRM account to continue</p>
          </div>

          {/* SSO error */}
          {ssoError && (
            <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
              <p className="text-sm text-destructive" data-testid="text-sso-error">
                Microsoft sign-in failed: {ssoError}
              </p>
            </div>
          )}

          {/* Microsoft SSO */}
          <Button
            type="button"
            variant="outline"
            className="w-full mb-5 gap-2"
            onClick={handleMicrosoftSignIn}
            data-testid="button-sign-in-microsoft"
          >
            <MicrosoftLogo className="h-4 w-4" />
            Sign in with Microsoft
          </Button>

          {/* Divider */}
          <div className="relative mb-5">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-2 text-muted-foreground">or sign in with email</span>
            </div>
          </div>

          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="login" data-testid="tab-login">Sign in</TabsTrigger>
              <TabsTrigger value="register" data-testid="tab-register">Create account</TabsTrigger>
            </TabsList>

            {/* Login tab */}
            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="login-email" className="text-sm font-medium">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="you@example.com"
                    value={loginData.email}
                    onChange={(e) => setLoginData({ ...loginData, email: e.target.value })}
                    required
                    data-testid="input-login-email"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="login-password" className="text-sm font-medium">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="Enter your password"
                    value={loginData.password}
                    onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
                    required
                    data-testid="input-login-password"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full mt-2"
                  disabled={loginMutation.isPending}
                  data-testid="button-login"
                >
                  {loginMutation.isPending ? "Signing in…" : "Sign in"}
                </Button>
                {loginMutation.isError && (
                  <p className="text-sm text-destructive text-center" data-testid="text-login-error">
                    Invalid email or password
                  </p>
                )}
              </form>
            </TabsContent>

            {/* Register tab */}
            <TabsContent value="register">
              <form onSubmit={handleRegister} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="register-name" className="text-sm font-medium">Full Name</Label>
                  <Input
                    id="register-name"
                    type="text"
                    placeholder="John Doe"
                    value={registerData.name}
                    onChange={(e) => setRegisterData({ ...registerData, name: e.target.value })}
                    required
                    data-testid="input-register-name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="register-email" className="text-sm font-medium">Email</Label>
                  <Input
                    id="register-email"
                    type="email"
                    placeholder="you@example.com"
                    value={registerData.email}
                    onChange={(e) => setRegisterData({ ...registerData, email: e.target.value })}
                    required
                    data-testid="input-register-email"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="register-password" className="text-sm font-medium">Password</Label>
                  <Input
                    id="register-password"
                    type="password"
                    placeholder="Min. 8 characters"
                    value={registerData.password}
                    onChange={(e) => setRegisterData({ ...registerData, password: e.target.value })}
                    required
                    minLength={8}
                    data-testid="input-register-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="register-confirm-password" className="text-sm font-medium">Confirm Password</Label>
                  <Input
                    id="register-confirm-password"
                    type="password"
                    placeholder="Re-enter password"
                    value={registerData.confirmPassword}
                    onChange={(e) => setRegisterData({ ...registerData, confirmPassword: e.target.value })}
                    required
                    data-testid="input-register-confirm-password"
                  />
                  {passwordMismatch && (
                    <p className="text-xs text-destructive" data-testid="text-password-mismatch">
                      Passwords do not match
                    </p>
                  )}
                </div>
                <Button
                  type="submit"
                  className="w-full mt-2"
                  disabled={registerMutation.isPending}
                  data-testid="button-register"
                >
                  {registerMutation.isPending ? "Creating account…" : "Create account"}
                </Button>
                {registerMutation.isError && (
                  <p className="text-sm text-destructive text-center" data-testid="text-register-error">
                    Registration failed. Try a different email.
                  </p>
                )}
              </form>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
