"use client";

import { AnimatePresence, LazyMotion, MotionConfig, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import type { ReactNode } from "react";

const loadFeatures = () => import("./motion-features").then(module => module.default);
export function MotionProvider({ children }: { children: ReactNode }) {
  return <LazyMotion features={loadFeatures} strict><MotionConfig reducedMotion="user">{children}</MotionConfig></LazyMotion>;
}

/** One shared transition language for onboarding, planning and adjustment. */
export function StepTransition({ step, direction = 1, className, children }: { step: string | number; direction?: number; className?: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  return <AnimatePresence mode="wait" initial={false}><m.section key={step} className={className}
    initial={{ opacity: 0, x: reduced ? 0 : direction * 18 }} animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: reduced ? 0 : direction * -12 }} transition={{ duration: reduced ? 0 : .24, ease: [.22, 1, .36, 1] }}>
    {children}
  </m.section></AnimatePresence>;
}
