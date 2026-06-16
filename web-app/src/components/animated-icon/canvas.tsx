// Animated icon for the Canvas feature.
// Visual motif: a framed canvas/whiteboard with two strokes that "draw in"
// via pathLength to evoke sketching on a blank surface.
"use client";

import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import { cn } from "@/lib/utils";

export interface CanvasIconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

interface CanvasIconProps extends HTMLAttributes<HTMLDivElement> {
  size?: number;
}

const CanvasIcon = forwardRef<CanvasIconHandle, CanvasIconProps>(
  ({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);

    useImperativeHandle(ref, () => {
      isControlledRef.current = true;

      return {
        startAnimation: () => controls.start("animate"),
        stopAnimation: () => controls.start("normal"),
      };
    });

    const handleMouseEnter = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseEnter?.(e);
        } else {
          controls.start("animate");
        }
      },
      [controls, onMouseEnter]
    );

    const handleMouseLeave = useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
          onMouseLeave?.(e);
        } else {
          controls.start("normal");
        }
      },
      [controls, onMouseLeave]
    );

    return (
      <div
        className={cn(className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...props}
      >
        <svg
          fill="none"
          height={size}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          width={size}
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Canvas frame */}
          <rect height="16" rx="2" width="18" x="3" y="4" />
          {/* Sketched curve — draws in on hover */}
          <motion.path
            animate={controls}
            d="M7 15c2-4 4-4 5-2s3 2 5-2"
            initial="normal"
            transition={{ duration: 0.6, ease: "easeInOut" }}
            variants={{
              normal: { pathLength: 1, opacity: 1 },
              animate: {
                pathLength: [0, 1],
                opacity: [0.4, 1],
              },
            }}
          />
          {/* Small accent dot — pen tip, fades in after stroke */}
          <motion.circle
            animate={controls}
            cx="17"
            cy="11"
            fill="currentColor"
            initial="normal"
            r="0.9"
            stroke="none"
            transition={{ duration: 0.4, ease: "easeOut", delay: 0.3 }}
            variants={{
              normal: { opacity: 1, scale: 1 },
              animate: { opacity: [0, 1], scale: [0.4, 1] },
            }}
          />
        </svg>
      </div>
    );
  }
);

CanvasIcon.displayName = "CanvasIcon";

export { CanvasIcon };
