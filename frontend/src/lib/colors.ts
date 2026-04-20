export const C = {
  /* Surfaces */
  bg:           "var(--surface)",
  surface:      "var(--surface-container-low)",
  surfaceHover: "var(--surface-container-high)",

  /* Borders */
  border:       "var(--outline-variant)",
  borderLight:  "var(--surface-bright)",

  /* Accent — orange */
  accent:     "var(--primary)",
  accentSoft: "var(--primary-container)",

  /* Semantic status */
  cyan:       "var(--status-info)",
  cyanSoft:   "color-mix(in srgb, var(--status-info) 12%, transparent)",
  green:      "var(--status-success)",
  greenSoft:  "color-mix(in srgb, var(--status-success) 12%, transparent)",
  amber:      "var(--status-warning)",
  amberSoft:  "color-mix(in srgb, var(--status-warning) 12%, transparent)",
  red:        "var(--status-danger)",
  redSoft:    "color-mix(in srgb, var(--status-danger) 12%, transparent)",
  purple:     "var(--status-planning)",
  purpleSoft: "color-mix(in srgb, var(--status-planning) 12%, transparent)",

  /* Text */
  text:      "var(--on-surface)",
  textSub:   "var(--on-surface-variant)",
  textMuted: "var(--on-surface-variant)",
};

export const mono = { fontFamily: "var(--font-sans, ui-sans-serif, system-ui)" };
