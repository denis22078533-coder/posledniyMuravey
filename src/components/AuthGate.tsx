import { useState } from "react";
import Icon from "@/components/ui/icon";
import { signIn, signUp, useAuth } from "@/lib/auth";
import { AntTyping } from "@/components/AntTyping";
import { toast } from "sonner";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  if (session) return <>{children}</>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const acc = signIn(email, password);
        toast.success(`Вход выполнен · ${acc.role}`);
      } else {
        const acc = signUp(email, password);
        toast.success(acc.role === "superadmin" ? "Создан Superadmin" : "Аккаунт создан");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground grid-bg flex items-center justify-center p-4 relative">
      <div className="absolute top-10 left-10 opacity-[0.08] animate-bg-ant hidden md:block">
        <AntTyping size={160} />
      </div>
      <div className="absolute bottom-10 right-10 opacity-[0.06] animate-bg-ant hidden md:block" style={{ animationDelay: "8s" }}>
        <AntTyping size={120} />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-orange-500 flex items-center justify-center font-heading font-bold text-xl text-black">М</div>
          <div>
            <div className="font-heading text-2xl tracking-wider uppercase">Муравей</div>
            <div className="text-[10px] text-muted-foreground font-mono">v2.0 · IDE</div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex gap-1 p-1 bg-secondary border border-border rounded-lg mb-5">
            <button
              onClick={() => setMode("signin")}
              className={`flex-1 py-2 rounded-md text-xs font-heading uppercase tracking-wider transition ${
                mode === "signin" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              }`}
            >Вход</button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 py-2 rounded-md text-xs font-heading uppercase tracking-wider transition ${
                mode === "signup" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
              }`}
            >Регистрация</button>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Email</div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm font-mono focus:border-purple-500/50 focus:outline-none"
              />
            </div>
            <div>
              <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5">Пароль</div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={4}
                placeholder="••••••••"
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2.5 text-sm font-mono focus:border-purple-500/50 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-purple-500 to-orange-500 text-black text-sm font-bold hover:opacity-90 transition disabled:opacity-50"
            >
              <Icon name={mode === "signin" ? "LogIn" : "UserPlus"} size={14} />
              {mode === "signin" ? "Войти" : "Создать аккаунт"}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-border">
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">Иерархия ролей</div>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> Superadmin — полный доступ</div>
              <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-purple-500" /> Moderator — чат, ZIP, аудит</div>
              <div className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" /> User — только чат</div>
            </div>
            <div className="text-[10px] font-mono text-muted-foreground mt-3 leading-relaxed">
              Первый зарегистрированный аккаунт автоматически становится владельцем. Email можно задать через ENV <code className="text-purple-400">VITE_ADMIN_EMAIL</code>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AuthGate;
