"use client";

import { useEffect, useState } from "react";

type Choice = "system" | "light" | "dark";

const CHOICES: readonly { value: Choice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * Sets `data-theme` on the document element, which is exactly what
 * lib/brand/tokens.css keys the dark block off. Reviewers can see both
 * schemes without changing an OS setting, and screenshots of either are
 * reproducible.
 *
 * The attribute is written after mount, so the server and the first client
 * render agree and nothing hydrates mismatched.
 */
export function SchemeSwitch() {
  const [choice, setChoice] = useState<Choice>("system");

  useEffect(() => {
    const root = document.documentElement;
    if (choice === "system") {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = choice;
    }
  }, [choice]);

  return (
    <div
      role="group"
      aria-label="Colour scheme"
      className="border-hairline inline-flex overflow-hidden rounded-sm border"
    >
      {CHOICES.map((option) => {
        const active = option.value === choice;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => setChoice(option.value)}
            style={{
              transition: `background-color var(--motion-duration-micro) var(--motion-ease-standard), color var(--motion-duration-micro) var(--motion-ease-standard)`,
            }}
            className={[
              "text-eyebrow min-h-11 cursor-pointer px-4 uppercase",
              active
                ? "bg-surface-accent text-on-accent"
                : "bg-surface-raised text-muted hover:text-primary",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
