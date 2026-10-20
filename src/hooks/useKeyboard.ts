import { useEffect, useRef } from "react";

export type KeyHandlers = {
  onSlash: () => void;
  onEscape: () => void;
  onDigit: (n: number) => void;
  onBrief: () => void;
};

const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** "/" focuses search, Esc closes, 0–8 switch layers, B opens the brief. Keys other than Esc are ignored while typing. */
export function useKeyboard(handlers: KeyHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        ref.current.onEscape();
        return;
      }
      if (isTyping(e.target)) return;
      if (e.key === "/") {
        e.preventDefault();
        ref.current.onSlash();
      } else if (/^[0-8]$/.test(e.key)) {
        ref.current.onDigit(Number(e.key));
      } else if (e.key === "b" || e.key === "B") {
        ref.current.onBrief();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
