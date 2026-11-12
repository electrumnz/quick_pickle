import type { ReactNode } from "react";

/**
 * The icon set. Drawn in the line style of the brand guide: thick navy
 * outline, flat fills, round joins, no lettering. Colour comes from the
 * current text colour and the token classes, never from a hex.
 *
 * Icons are decoration. The control or the sentence next to one carries the
 * name, so every icon here is hidden from assistive technology.
 */

type IconProps = { readonly className?: string };

function Svg({
  className,
  children,
  viewBox = "0 0 32 32",
}: IconProps & { readonly children: ReactNode; readonly viewBox?: string }) {
  return (
    <svg
      viewBox={viewBox}
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** The jar: Quick Pickle's word, and shape, for a cart. */
export function JarIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect
        x="9"
        y="3.5"
        width="14"
        height="5"
        rx="1.5"
        className="fill-olive"
      />
      <path
        d="M8 11.5c0-1.7 1.3-3 3-3h10c1.7 0 3 1.3 3 3v13c0 2.2-1.8 4-4 4h-8c-2.2 0-4-1.8-4-4z"
        className="fill-cream"
      />
      <path d="M12 15v7" strokeWidth={2} />
    </Svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M16 7v18M7 16h18" strokeWidth={3.2} />
    </Svg>
  );
}

export function MinusIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M7 16h18" strokeWidth={3.2} />
    </Svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 8l16 16M24 8L8 24" strokeWidth={3.2} />
    </Svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6.5 16.5l6 6L26 9" strokeWidth={3.4} />
    </Svg>
  );
}

export function ArrowIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 16h20M18 8.5l7.5 7.5-7.5 7.5" strokeWidth={3.2} />
    </Svg>
  );
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8 12l8 8 8-8" strokeWidth={3.2} />
    </Svg>
  );
}

export function TruckIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect
        x="2.5"
        y="9"
        width="16"
        height="12"
        rx="1.5"
        className="fill-cream"
      />
      <path d="M18.5 13h6l4.5 4.5V21h-10.5z" className="fill-pink" />
      <circle cx="9" cy="23" r="3" className="fill-navy" />
      <circle cx="23.5" cy="23" r="3" className="fill-navy" />
    </Svg>
  );
}

export function LockIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect
        x="6.5"
        y="14"
        width="19"
        height="13.5"
        rx="2.5"
        className="fill-olive"
      />
      <path d="M10.5 14v-3.5a5.5 5.5 0 0111 0V14" />
    </Svg>
  );
}

export function HeartIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path
        d="M16 27S4.5 20 4.5 12a6 6 0 0111.5-2.4A6 6 0 0127.5 12c0 8-11.5 15-11.5 15z"
        className="fill-pink"
      />
    </Svg>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect
        x="4.5"
        y="7"
        width="23"
        height="20"
        rx="3"
        className="fill-cream"
      />
      <path d="M4.5 13h23M10.5 4v6M21.5 4v6" />
      <path
        d="M11 20l3.5 3.5L21.5 17"
        className="stroke-pink"
        strokeWidth={3}
      />
    </Svg>
  );
}

/** A drop: just the juice. */
export function DropIcon({ className }: IconProps) {
  return (
    <Svg className={className} viewBox="0 0 48 48">
      <path
        d="M24 5.5S10.5 20 10.5 29.5a13.5 13.5 0 0027 0C37.5 20 24 5.5 24 5.5z"
        className="fill-olive-wash"
        strokeWidth={3.4}
      />
      <path d="M18 30a6.5 6.5 0 005 6.2" strokeWidth={3} />
    </Svg>
  );
}

/** A tiny bottle: tiny package. */
export function BottleIcon({ className }: IconProps) {
  return (
    <Svg className={className} viewBox="0 0 48 48">
      <rect
        x="18.5"
        y="4.5"
        width="11"
        height="7"
        rx="2"
        className="fill-navy"
        strokeWidth={3.4}
      />
      <path
        d="M19.5 11.5v3.2c0 1.4-.6 2.6-1.7 3.5C15.7 20 14.5 22 14.5 24.500v14c0 2.800 2.200 5 5 5h9c2.800 0 5-2.200 5-5v-14c0-2.500-1.200-4.500-3.300-6.300-1.100-.900-1.700-2.100-1.700-3.500V11.500"
        className="fill-olive-wash"
        strokeWidth={3.4}
      />
      <rect
        x="14.500"
        y="25"
        width="19"
        height="10"
        className="fill-pink"
        strokeWidth={3}
      />
    </Svg>
  );
}

/** The sour face. Everyone pulls it. */
export function FaceIcon({ className }: IconProps) {
  return (
    <Svg className={className} viewBox="0 0 48 48">
      <circle
        cx="24"
        cy="24"
        r="18.500"
        className="fill-olive"
        strokeWidth={3.4}
      />
      <path
        d="M13.500 19.500l6 2.500-6 2.500M34.500 19.500l-6 2.500 6 2.500"
        strokeWidth={3.2}
      />
      <path
        d="M17.500 33c1.600-2.200 3.200-2.200 4.400 0s2.800 2.200 4.200 0 2.800-2.200 4.400 0"
        strokeWidth={3.2}
      />
    </Svg>
  );
}

/** A tick in a rosette: said straight. */
export function StraightIcon({ className }: IconProps) {
  return (
    <Svg className={className} viewBox="0 0 48 48">
      <path
        d="M24 4.500l4.800 3.900 6.200-.500 1.400 6 5.300 3.200-2.400 5.700 2.400 5.700-5.300 3.200-1.400 6-6.200-.500L24 41.500l-4.800-3.900-6.200.500-1.400-6-5.300-3.200 2.400-5.700-2.400-5.700 5.300-3.200 1.400-6 6.200.500z"
        className="fill-pink"
        strokeWidth={3.2}
      />
      <path
        d="M16.500 23.500l5 5 10-10.500"
        className="stroke-cream"
        strokeWidth={4}
      />
    </Svg>
  );
}

/**
 * Burst marks: the pink lines that fly off Lucky's pickle. Used as a pop
 * around a button when something lands in the jar, and as a flourish.
 */
export function Burst({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <g className="fill-current">
        <path d="M50 2l5 26H45z" />
        <path d="M84 16L66 36l-7-7z" />
        <path d="M98 50l-26 5V45z" />
        <path d="M84 84L64 66l7-7z" />
        <path d="M50 98l-5-26h10z" />
        <path d="M16 84l18-20 7 7z" />
        <path d="M2 50l26-5v10z" />
        <path d="M16 16l20 18-7 7z" />
      </g>
    </svg>
  );
}

/** Four-point sparkle from the sticker sheet. */
export function Sparkle({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="fill-current"
        d="M12 0l2.600 9.400L24 12l-9.400 2.600L12 24l-2.600-9.400L0 12l9.400-2.600z"
      />
    </svg>
  );
}
