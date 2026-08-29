/**
 * The admin's icon set, drawn here rather than installed.
 *
 * Nine destinations need nine marks that read at 18px and agree with each
 * other; a general-purpose icon library would have brought a thousand that do
 * not. Every path is stroked in `currentColor`, so an icon is whatever colour
 * the semantic token around it says — there is no colour in this file at all.
 */

export type IconProps = { readonly className?: string };

function Svg({
  children,
  className = "size-4",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

/** Today — a sun over the horizon. */
export function IconToday({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="11" r="3.6" />
      <path d="M12 3.5v1.8M12 16.7v1.3M4.9 11H3.2M20.8 11h-1.7M6.9 5.9 5.7 4.7M18.3 4.7l-1.2 1.2M3 20.5h18" />
    </Svg>
  );
}

/** Orders — a parcel. */
export function IconOrders({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3.5 7.6 12 3.5l8.5 4.1v8.8L12 20.5l-8.5-4.1z" />
      <path d="M3.5 7.6 12 11.7l8.5-4.1M12 11.7v8.8" />
    </Svg>
  );
}

/** Stock — a jar on a shelf. */
export function IconStock({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M8.5 3.5h7M9.2 6.2h5.6a2 2 0 0 1 2 2v10.3a2 2 0 0 1-2 2H9.2a2 2 0 0 1-2-2V8.2a2 2 0 0 1 2-2z" />
      <path d="M7.2 12.6h9.6M8.5 3.5v2.7M15.5 3.5v2.7" />
    </Svg>
  );
}

/** Social — a speech bubble with a spark. */
export function IconSocial({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M20.5 12.2c0 3.9-3.8 7-8.5 7-1 0-2-.1-2.9-.4l-5.6 1.7 1.8-4.4a6.5 6.5 0 0 1-1.8-4.4c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7.5z" />
      <path d="M9.3 11.9h5.4" />
    </Svg>
  );
}

/** Customers — two people. */
export function IconCustomers({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="9.6" cy="8.4" r="3.2" />
      <path d="M3.6 19.6c0-3.1 2.7-5.2 6-5.2s6 2.1 6 5.2" />
      <path d="M16.2 6.1a3 3 0 0 1 .6 5.9M17.6 14.9c2 .6 3.4 2.3 3.4 4.5" />
    </Svg>
  );
}

/** Money — a note. */
export function IconMoney({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="2.8" y="6.2" width="18.4" height="11.6" rx="2" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="M6.2 9.6v4.8M17.8 9.6v4.8" />
    </Svg>
  );
}

/** Brand and plan — a compass rose. */
export function IconBrand({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="m15.2 8.8-1.9 4.5-4.5 1.9 1.9-4.5z" />
    </Svg>
  );
}

/** The team — a badge with a person. */
export function IconTeam({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.4" />
      <circle cx="9.4" cy="10.4" r="2.1" />
      <path d="M6 16.4c0-1.8 1.5-3 3.4-3s3.4 1.2 3.4 3M15.4 9.6h3.2M15.4 13.2h3.2" />
    </Svg>
  );
}

/** Settings — a dial. */
export function IconSettings({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6.5 5.5v13M12 5.5v13M17.5 5.5v13" />
      <circle cx="6.5" cy="9.4" r="1.9" />
      <circle cx="12" cy="14.6" r="1.9" />
      <circle cx="17.5" cy="8.2" r="1.9" />
    </Svg>
  );
}

export function IconSearch({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.6 15.6 4 4" />
    </Svg>
  );
}

export function IconMenu({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

export function IconClose({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Svg>
  );
}

export function IconSun({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
    </Svg>
  );
}

export function IconMoon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2z" />
    </Svg>
  );
}

export function IconAlert({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 4.6 21 19.4H3z" />
      <path d="M12 10v4M12 16.6h.01" />
    </Svg>
  );
}

export function IconChevron({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m9 5 7 7-7 7" />
    </Svg>
  );
}

export function IconApproval({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M5 12.8 9.6 17 19 6.8" />
    </Svg>
  );
}
