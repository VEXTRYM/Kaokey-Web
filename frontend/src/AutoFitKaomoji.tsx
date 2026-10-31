import { useLayoutEffect, useRef } from "react";

const MAX_FONT_SIZE = 36;
const MIN_FONT_SIZE = 16;
const WIDTH_USAGE = 0.92;

/**
 * Fit each kaomoji to a single line using its real, unconstrained DOM width.
 *
 * A hidden measurement copy uses the same font, fallback glyphs and shaping
 * as the visible text, but is not clipped by its container. This avoids
 * unreliable scrollWidth measurements on ellipsized elements.
 *
 * At the 16px readability floor, unusually long kaomoji are ellipsized.
 * The full text remains available via the card's hover/focus tooltip.
 */
export default function AutoFitKaomoji({ text }: { text: string }) {
  const previewRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const preview = previewRef.current;
    const measure = measureRef.current;
    const parent = preview?.parentElement;
    if (!preview || !measure || !parent) return;

    let disposed = false;

    function fit() {
      if (disposed || !preview || !measure) return;
      const availableWidth = preview.getBoundingClientRect().width;
      const fullWidth = measure.getBoundingClientRect().width;

      if (availableWidth <= 0 || fullWidth <= 0) return;

      // The measurement copy always uses MAX_FONT_SIZE at natural width.
      // Scaling the font directly avoids binary-search rounding errors and
      // doesn't rely on the clipped element's scrollWidth.
      const fittedSize = MAX_FONT_SIZE * (availableWidth * WIDTH_USAGE / fullWidth);
      const size = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, fittedSize));
      preview.style.fontSize = size.toFixed(2) + "px";
    }

    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    fit();

    // Account for late-loading web fonts and font fallback changes.
    const fonts = document.fonts;
    void fonts?.ready.then(() => { if (!disposed) fit(); });
    fonts?.addEventListener("loadingdone", fit);

    return () => {
      disposed = true;
      observer.disconnect();
      fonts?.removeEventListener("loadingdone", fit);
    };
  }, [text]);

  return <>
    <span ref={previewRef} className="face">{text}</span>
    <span ref={measureRef} className="face face-measure" aria-hidden="true">{text}</span>
  </>;
}
