export function AntTyping({ size = 90 }: { size?: number }) {
  return (
    <div className="relative inline-flex flex-col items-center" style={{ width: size * 1.6 }}>
      {/* Муравей */}
      <div className="relative" style={{ width: size, height: size * 0.7 }}>
        <svg viewBox="0 0 100 70" className="w-full h-full overflow-visible">
          {/* Тело: 3 сегмента */}
          <g className="animate-ant-body">
            {/* Усики */}
            <line x1="22" y1="22" x2="14" y2="10" stroke="#0f0f0f" strokeWidth="2" strokeLinecap="round" className="animate-antenna-l" style={{ transformBox: "fill-box" }} />
            <line x1="28" y1="22" x2="26" y2="6" stroke="#0f0f0f" strokeWidth="2" strokeLinecap="round" className="animate-antenna-r" style={{ transformBox: "fill-box" }} />
            <circle cx="14" cy="10" r="1.6" fill="#a855f7" />
            <circle cx="26" cy="6" r="1.6" fill="#ff6b1a" />

            {/* Голова */}
            <ellipse cx="25" cy="32" rx="11" ry="10" fill="#1a1a1a" stroke="#a855f7" strokeWidth="1.5" />
            {/* Глаза */}
            <circle cx="20" cy="30" r="2.2" fill="#fff" />
            <circle cx="29" cy="30" r="2.2" fill="#fff" />
            <circle cx="20.5" cy="30.5" r="1.1" fill="#0f0f0f" />
            <circle cx="29.5" cy="30.5" r="1.1" fill="#0f0f0f" />
            {/* Улыбка */}
            <path d="M 21 36 Q 25 38 29 36" stroke="#a855f7" strokeWidth="1.2" fill="none" strokeLinecap="round" />

            {/* Грудь */}
            <ellipse cx="48" cy="36" rx="13" ry="11" fill="#0f0f0f" stroke="#a855f7" strokeWidth="1.5" />
            {/* Брюшко */}
            <ellipse cx="74" cy="38" rx="16" ry="13" fill="#1a1a1a" stroke="#ff6b1a" strokeWidth="1.5" />
            {/* Полоски на брюшке */}
            <path d="M 66 32 Q 74 36 82 32" stroke="#ff6b1a" strokeWidth="1" fill="none" opacity="0.6" />
            <path d="M 66 42 Q 74 46 82 42" stroke="#ff6b1a" strokeWidth="1" fill="none" opacity="0.6" />

            {/* Лапки задние и средние — стоят на земле */}
            <line x1="42" y1="46" x2="38" y2="58" stroke="#0f0f0f" strokeWidth="2" strokeLinecap="round" />
            <line x1="54" y1="46" x2="58" y2="58" stroke="#0f0f0f" strokeWidth="2" strokeLinecap="round" />
            <line x1="68" y1="50" x2="72" y2="62" stroke="#0f0f0f" strokeWidth="2" strokeLinecap="round" />

            {/* Передние лапки — печатают! */}
            <g className="animate-ant-paw1">
              <line x1="38" y1="32" x2="32" y2="48" stroke="#0f0f0f" strokeWidth="2" strokeLinecap="round" />
              <circle cx="32" cy="48" r="2" fill="#a855f7" />
            </g>
            <g className="animate-ant-paw2">
              <line x1="44" y1="32" x2="46" y2="48" stroke="#0f0f0f" strokeWidth="2" strokeLinecap="round" />
              <circle cx="46" cy="48" r="2" fill="#ff6b1a" />
            </g>
          </g>
        </svg>
      </div>

      {/* Ноутбук */}
      <div className="relative -mt-2" style={{ width: size * 1.4 }}>
        {/* Экран */}
        <div className="relative h-7 rounded-t-md bg-gradient-to-b from-purple-500/40 to-orange-500/30 border border-purple-500/50 overflow-hidden animate-screen">
          <div className="absolute inset-1 bg-background/80 rounded-sm flex items-center px-1.5 gap-0.5">
            <div className="w-1 h-1 rounded-full bg-red-500/60" />
            <div className="w-1 h-1 rounded-full bg-yellow-500/60" />
            <div className="w-1 h-1 rounded-full bg-green-500/60" />
            <div className="flex-1 ml-1 font-mono text-[7px] text-purple-400 flex items-center gap-0.5 truncate">
              <span>{"<div>"}</span>
              <span className="animate-cursor text-orange-400">|</span>
            </div>
          </div>
        </div>
        {/* Клавиатура */}
        <div className="h-1.5 bg-gradient-to-r from-purple-500/30 via-foreground/20 to-orange-500/30 rounded-b-md border-x border-b border-border" />
        <div className="h-0.5 bg-foreground/10 rounded-b-md mx-2" />
      </div>
    </div>
  );
}

export default AntTyping;
