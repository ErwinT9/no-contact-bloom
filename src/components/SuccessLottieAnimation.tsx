import { Lottie } from "lottie-react";

import animationData from "@/assets/turtle-success.json";

/**
 * Shared success Lottie shown after a saved trigger log or journal entry.
 * Lazy-loaded by callers so the Lottie engine never touches SSR. Plays once at
 * its original speed and calls `onComplete` when it finishes so the overlay can
 * dismiss itself. The source animation is 320x400, so the wrapper preserves
 * that aspect ratio and scales responsively without overflowing.
 */
export default function SuccessLottieAnimation({ onComplete }: { onComplete?: () => void }) {
  return (
    <Lottie
      src={animationData}
      autoplay
      loop={false}
      subscriptions={{ complete: () => onComplete?.() }}
      className="mx-auto aspect-[4/5] h-[min(62dvh,400px)] w-auto max-w-[80vw]"
      aria-hidden
    />
  );
}
