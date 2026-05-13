import { useEffect, useRef, useState } from "react";
import Icon from "@/components/ui/icon";
import { useAuth } from "@/lib/auth";
import {
  addMessage, getOrCreateThread, markReadForUser, shouldEscalate, escalate, useSupport,
  SUPPORT_KB_PROMPT,
} from "@/lib/support";
import { chat, type ChatMessage } from "@/lib/ai";
import { toast } from "sonner";

export function SupportWidget() {
  const { session, isModerator } = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const { threads } = useSupport();
  const scrollRef = useRef<HTMLDivElement>(null);

  const email = session?.email || "";
  const thread = email ? (threads.find((t) => t.email === email) || getOrCreateThread(email)) : null;
  const unread = thread?.unreadForUser || 0;
  const msgCount = thread?.messages.length || 0;

  useEffect(() => {
    if (open && email) markReadForUser(email);
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [open, email, msgCount]);

  if (!session || isModerator || !thread) return null;

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    addMessage(email, "user", text);
    setInput("");

    if (shouldEscalate(text) || thread.escalated) {
      if (!thread.escalated) {
        escalate(email);
        toast.message("Запрос передан оператору");
      }
      return;
    }

    setBusy(true);
    try {
      const history: ChatMessage[] = [
        { role: "system", content: SUPPORT_KB_PROMPT },
        ...thread.messages.slice(-10).map((m) => ({
          role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
          content: m.text,
        })),
        { role: "user", content: text },
      ];
      const reply = await chat(history);
      addMessage(email, "ai", reply);
    } catch (e: unknown) {
      addMessage(email, "ai", `Не удалось ответить: ${e instanceof Error ? e.message : "ошибка"}. Напишите «оператор» — подключим человека.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-24 right-5 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-orange-500 text-black shadow-2xl flex items-center justify-center hover:scale-105 transition"
        title="Поддержка"
      >
        <Icon name={open ? "X" : "LifeBuoy"} size={22} />
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-background">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed bottom-44 right-5 z-40 w-[360px] max-w-[calc(100vw-2.5rem)] h-[520px] max-h-[calc(100vh-12rem)] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fade-up">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-orange-500 flex items-center justify-center">
              <Icon name="LifeBuoy" size={14} className="text-black" />
            </div>
            <div className="flex-1">
              <div className="font-heading text-sm uppercase tracking-wider">Поддержка</div>
              <div className="text-[10px] font-mono text-muted-foreground">
                {thread.escalated ? "оператор уведомлён" : "ИИ-ассистент онлайн"}
              </div>
            </div>
            <span className={`w-2 h-2 rounded-full ${thread.escalated ? "bg-orange-500" : "bg-green-500"} animate-pulse-dot`} />
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-3">
            {thread.messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap break-words ${
                  m.role === "user"
                    ? "bg-foreground text-background rounded-br-sm"
                    : m.role === "admin"
                      ? "bg-orange-500/10 text-foreground border border-orange-500/30 rounded-bl-sm"
                      : "bg-secondary text-foreground border border-border rounded-bl-sm"
                }`}>
                  {m.role === "admin" && <div className="text-[9px] font-mono uppercase tracking-wider text-orange-400 mb-0.5">Оператор</div>}
                  {m.text}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="bg-secondary text-muted-foreground border border-border rounded-2xl rounded-bl-sm px-3 py-2 text-xs flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse-dot" />
                  ИИ печатает...
                </div>
              </div>
            )}
          </div>

          <div className="p-2.5 border-t border-border">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                placeholder={thread.escalated ? "Оператор скоро ответит..." : "Ваш вопрос..."}
                className="flex-1 bg-secondary border border-border rounded-lg px-3 py-2 text-xs focus:border-purple-500/50 focus:outline-none"
                disabled={busy}
              />
              <button
                onClick={send}
                disabled={busy || !input.trim()}
                className="px-3 rounded-lg bg-gradient-to-r from-purple-500 to-orange-500 text-black hover:opacity-90 transition disabled:opacity-50"
              >
                <Icon name="Send" size={12} />
              </button>
            </div>
            {!thread.escalated && (
              <button
                onClick={() => { escalate(email); toast.success("Оператор уведомлён"); }}
                className="mt-2 w-full text-[10px] font-mono text-muted-foreground hover:text-orange-400 transition"
              >
                Позвать оператора →
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export default SupportWidget;