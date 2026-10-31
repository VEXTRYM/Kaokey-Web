import { useLayoutEffect, useRef } from "react";

const MAX_FONT_SIZE = 36;
const MIN_FONT_SIZE = 12;

/**
 * Keep a kaomoji on exactly one line. Measure its actual rendered width
 * (including emoji and fallback fonts), rather than guessing by text length.
 * At 12px, exceptionally long strings use an ellipsis; the full text is
 * available in the card's hover/focus tooltip.
 */
export default function AutoFitKaomoji({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    let disposed = false;
    const fit = () => {
      if (disposed || element.clientWidth <= 0) return;

      element.style.fontSize = MAX_FONT_SIZE + "px";
      if (element.scrollWidth <= element.clientWidth) return;

      // Binary search for the largest font size that fits on one line.
      let low = MIN_FONT_SIZE;
      let high = MAX_FONT_SIZE;
      for (let step = 0; step < 9; step++) {
        const middle = (low + high) / 2;
        element.style.fontSize = middle + "px";
        if (element.scrollWidth <= element.clientWidth) low = middle;
        else high = middle;
      }
      element.style.fontSize = Math.floor(low * 10) / 10 + "px";
    };

    const observer = new ResizeObserver(fit);
    // Observe the preview container, not the resized text, to avoid loops.
    if (element.parentElement) observer.observe(element.parentElement);
    fit();

    // Web fonts may load after first paint and change glyph widths.
    const fonts = document.fonts;
    void fonts?.ready.then(() => { if (!disposed) fit(); });
    fonts?.addEventListener("loadingdone", fit);

    return () => {
      disposed = true;
      observer.disconnect();
      fonts?.removeEventListener("loadingdone", fit);
    };
  }, [text]);

  return <span ref={ref} className="face">{text}</span>;
}
