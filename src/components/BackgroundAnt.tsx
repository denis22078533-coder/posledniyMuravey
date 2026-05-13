import { AntTyping } from "./AntTyping";

export function BackgroundAnt() {
  // Падающие символы кода
  const codeBits = Array.from({ length: 14 }, (_, i) => ({
    id: i,
    left: (i * 7.3) % 100,
    delay: (i * 1.7) % 12,
    duration: 8 + ((i * 3) % 7),
    char: ["</>", "{}", "()", "<>", "=>", "//", "#", "$", "*", "[]"][i % 10],
  }));

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Падающие символы кода */}
      {codeBits.map((b) => (
        <div
          key={b.id}
          className="absolute font-mono text-xs text-purple-500/20 animate-code-rain"
          style={{
            left: `${b.left}%`,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.duration}s`,
          }}
        >
          {b.char}
        </div>
      ))}

      {/* Большой полупрозрачный муравей в правом нижнем углу */}
      <div className="absolute bottom-32 right-8 opacity-[0.07] animate-bg-ant hidden md:block" style={{ animationDelay: "0s" }}>
        <AntTyping size={180} />
      </div>

      {/* Маленький в левом верхнем */}
      <div className="absolute top-24 left-8 opacity-[0.05] animate-bg-ant hidden lg:block" style={{ animationDelay: "6s" }}>
        <AntTyping size={120} />
      </div>

      {/* Средний по центру справа */}
      <div className="absolute top-1/2 right-1/4 opacity-[0.04] animate-bg-ant hidden xl:block" style={{ animationDelay: "12s" }}>
        <AntTyping size={100} />
      </div>
    </div>
  );
}

export default BackgroundAnt;
