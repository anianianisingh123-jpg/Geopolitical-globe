import { useEffect, useState, type RefObject } from "react";

/** Latches true the first time the element comes within `margin` of the viewport. */
export function useInView(ref: RefObject<Element | null>, enabled: boolean, margin = "200px"): boolean {
  const [seen, setSeen] = useState(!enabled);
  useEffect(() => {
    if (!enabled || seen) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, enabled, seen, margin]);
  return seen || !enabled;
}
