// Shared controls: the one select component, and links that leave the
// workshop. Every dropdown and every new-tab link in the UI uses these, so
// geometry, contrast and the "opens in a new tab" hint are the same everywhere.
import Markdown from "react-markdown";
import React, { useId, useState } from "react";
import { Keys } from "./palette.jsx";

// ---------- icons ----------
// One small set: 16 px grid, 1.5 px round strokes, drawn in the text colour.
const ICONS = {
  command: "M5.5 5.5h5v5h-5z M5.5 5.5H4A1.5 1.5 0 1 1 5.5 4z M10.5 5.5V4A1.5 1.5 0 1 1 12 5.5z M10.5 10.5H12a1.5 1.5 0 1 1-1.5 1.5z M5.5 10.5V12A1.5 1.5 0 1 1 4 10.5z",
  keyboard: "M3 4h10a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 13 12H3a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 3 4z M4.25 6.75h.01 M6.75 6.75h.01 M9.25 6.75h.01 M11.75 6.75h.01 M4.25 9.25h.01 M11.75 9.25h.01 M6.5 9.25h3",
  sections: "M2.5 4h.01 M5.5 4h8 M2.5 8h.01 M5.5 8h8 M2.5 12h.01 M5.5 12h8",
  expand: "M4 6l4 4 4-4",
};
export function Icon({ name }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} />
    </svg>
  );
}

/** The shortest of a command's bindings, for a tooltip. */
export const shortBinding = (list) => [...(list || [])].sort((a, b) => a.split(/[+ ]/).length - b.split(/[+ ]/).length)[0] || "";

/**
 * A button with a tooltip that says what it does and shows its shortcut, on
 * hover and on keyboard focus. With `iconOnly` the label is the accessible
 * name; otherwise it is the visible text. Escape hides the tooltip.
 */
export function TipButton({ icon, label, tip, binding, iconOnly = false, align = "center", className = "", children, ...props }) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);
  const show = () => setDismissed(false);
  return (
    <span
      className={"tip-host" + (dismissed ? " tip-dismissed" : "")}
      data-align={align}
      onMouseLeave={show}
      onBlur={show}
      onKeyDown={(event) => event.key === "Escape" && setDismissed(true)}
    >
      <button {...props} className={((iconOnly ? "icon-button " : "") + className).trim()} aria-label={iconOnly ? label : undefined} aria-describedby={id}>
        {icon && <Icon name={icon} />}
        {!iconOnly && <span>{children ?? label}</span>}
      </button>
      <span role="tooltip" id={id} className="tooltip">
        {tip}
        {binding && <Keys binding={binding} />}
      </span>
    </span>
  );
}

/**
 * The workshop's dropdown: a native select with the control height, padding
 * and inset arrow shared with buttons (styles: ".select").
 */
export function Select({ className = "", children, ...props }) {
  return (
    <span className={"select" + (className ? " " + className : "")}>
      <select {...props}>{children}</select>
      <span className="select-arrow" aria-hidden="true" />
    </span>
  );
}

/** Same wording as the lesson sanitiser (markdown.mjs, NEW_TAB_HINT). */
export const NEW_TAB_HINT = " (opens in a new tab)";

/** True for an http(s) URL on another origin than the workshop page. */
export function isExternalHref(href) {
  if (typeof href !== "string" || !href) return false;
  try {
    const url = new URL(href, window.location.href);
    return /^https?:$/.test(url.protocol) && url.origin !== window.location.origin;
  } catch {
    return false;
  }
}

/**
 * A link that opens a new tab, so the workshop page stays where it is. The
 * hint is visually hidden text inside the link, part of its accessible name;
 * the arrow drawn by the stylesheet is decorative.
 */
export function ExternalLink({ href, children, className = "", rel = "noopener noreferrer", hint = true, ...rest }) {
  return (
    <a {...rest} href={href} target="_blank" rel={rel} className={("external-link " + className).trim()}>
      {children}
      {hint && <span className="visually-hidden new-tab-hint">{NEW_TAB_HINT}</span>}
    </a>
  );
}

const proseComponents = {
  a({ node, href, children, ...props }) {
    return isExternalHref(href) ? (
      <ExternalLink href={href} rel="noopener noreferrer nofollow">
        {children}
      </ExternalLink>
    ) : (
      <a {...props} href={href}>
        {children}
      </a>
    );
  },
};
/** Markdown rendered in the page (tutor answers, transcripts, plain lessons). */
export function Prose({ children }) {
  return <Markdown components={proseComponents}>{children}</Markdown>;
}
