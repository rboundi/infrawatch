import { useEffect, useRef } from "react";
import type { NavigateFunction } from "react-router-dom";

const CHORDS: Record<string, string> = {
  h: "/hosts",
  a: "/alerts",
  d: "/",
  s: "/setup/targets",
  r: "/setup/reports",
  i: "/discovery",
};

function isInput(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable;
}

export function useKeyboardShortcuts(
  navigate: NavigateFunction,
  setShowShortcuts: (show: boolean) => void,
) {
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Escape always works — close modals
      if (e.key === "Escape") {
        setShowShortcuts(false);
        return;
      }

      // Skip other shortcuts when in form inputs
      if (isInput(e.target)) return;

      // ? — show shortcuts help
      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts(true);
        return;
      }

      // / — focus search
      if (e.key === "/") {
        const search = document.querySelector<HTMLInputElement>('input[placeholder*="Search"]');
        if (search) {
          e.preventDefault();
          search.focus();
        }
        return;
      }

      // g prefix for chord
      if (e.key === "g" && !pending.current) {
        pending.current = true;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => { pending.current = false; }, 1000);
        return;
      }

      // Second key of chord
      if (pending.current) {
        pending.current = false;
        clearTimeout(timer.current);
        const dest = CHORDS[e.key];
        if (dest) {
          e.preventDefault();
          navigate(dest);
        }
      }
    }

    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      clearTimeout(timer.current);
    };
  }, [navigate, setShowShortcuts]);
}
