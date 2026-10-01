---
name: Zen Modern
colors:
  surface: '#f9f9ff'
  surface-dim: '#d3daef'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f1f3ff'
  surface-container: '#e9edff'
  surface-container-high: '#e1e8fd'
  surface-container-highest: '#dce2f7'
  on-surface: '#141b2b'
  on-surface-variant: '#3d4a42'
  inverse-surface: '#293040'
  inverse-on-surface: '#edf0ff'
  outline: '#6d7a72'
  outline-variant: '#bccac0'
  surface-tint: '#006c4a'
  primary: '#006948'
  on-primary: '#ffffff'
  primary-container: '#00855d'
  on-primary-container: '#f5fff7'
  inverse-primary: '#68dba9'
  secondary: '#006a63'
  on-secondary: '#ffffff'
  secondary-container: '#99efe5'
  on-secondary-container: '#006f67'
  tertiary: '#b90538'
  on-tertiary: '#ffffff'
  tertiary-container: '#dc2c4f'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#85f8c4'
  primary-fixed-dim: '#68dba9'
  on-primary-fixed: '#002114'
  on-primary-fixed-variant: '#005137'
  secondary-fixed: '#9cf2e8'
  secondary-fixed-dim: '#80d5cb'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#00504a'
  tertiary-fixed: '#ffdadb'
  tertiary-fixed-dim: '#ffb2b7'
  on-tertiary-fixed: '#40000d'
  on-tertiary-fixed-variant: '#92002a'
  background: '#f9f9ff'
  on-background: '#141b2b'
  surface-variant: '#dce2f7'
typography:
  display-hero:
    fontFamily: Plus Jakarta Sans
    fontSize: 56px
    fontWeight: '700'
    lineHeight: 64px
    letterSpacing: -0.03em
  display-hero-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 38px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 48px
    letterSpacing: -0.025em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 30px
    fontWeight: '600'
    lineHeight: 38px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
    letterSpacing: -0.005em
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.04em
  numerical-metric:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.03em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-sm: 1rem
  gutter-lg: 2rem
  margin: 2rem
  margin-mobile: 1.25rem
  margin-desktop: 3rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
---

## Brand & Style

This design system fuses Scandinavian functional restraint with Japanese minimalist architectural clarity (Japandi wellness luxury). The aesthetic emphasizes hyper-clarity, mindful interaction rhythms, and sensory calm. Designed for high-consideration health, regenerative longevity, and curated wellness retreats, the interface eliminates cognitive clutter through generous breathing room, structured bento surfaces, and tactile reassurance.

The visual style pairs structural geometric typography with organic matcha greens and warm porcelain neutrals. Interactions feel grounded and deliberate, favoring subtle elevation transitions and muted physical presence over flashiness. The goal is to evoke the quiet luxury of a boutique Kyoto ryokan framed with Nordic architectural precision: direct, serene, elevated, and impeccably organized.

## Colors

The palette is anchored by natural botanical depth and serene, tactile stone tones:

- **Primary (`#059669`)**: A grounded matcha emerald representing vitality, botanical precision, and balance. Used for critical CTAs, active highlights, key navigation targets, and positive wellness indicators.
- **Secondary (`#0F766E`)**: A deep spruce teal providing supporting depth for secondary interactions, data visualizations, and elevated card highlights.
- **Tertiary (`#F43F5E`)**: A soft coral rose reserved exclusively for alerts, contraindications, heart-rate or biometric anomalies, and destructive confirmation steps.
- **Neutral (`#111827`)**: Obsidian ink for crisp, high-contrast editorial typography, ensuring effortless legibility against light backdrops.

### Surface and Canvas Hierarchy
- **Canvas Base**: Warm porcelain (`#F8F9FA` to `#F1F3F5`) creates a soft organic backdrop that avoids digital glare.
- **Surface Level 1**: Pure crisp white (`#FFFFFF`) used for elevated bento containers, inputs, and floating sheets.
- **Muted Elements**: Warm pebble slate (`#64748B`) for secondary metadata, timestamps, and resting iconography.
- **Borders & Separators**: Translucent neutral hairpins (`rgba(17, 24, 39, 0.06)`) preserve form definition without visual noise.

## Typography

Typography relies uniformly on **Plus Jakarta Sans**, leveraging its modern geometric structure, rounded terminals, and spacious counterforms. This balances architectural exactness with organic approachability.

- **Headlines**: Use medium to bold weights with tighter tracking (`-0.015em` to `-0.03em`) to anchor layouts with editorial authority without aggressive heaviness.
- **Body Text**: Tuned for effortless scans with a relaxed line height ratio (`1.55` - `1.6`) to prevent eye fatigue during lengthy protocol readouts.
- **Labels & Badges**: Set in semi-bold and uppercase formats for `label-sm` with deliberate tracking to ensure high-visibility at small scales.
- **Numerical Metric**: Tailored for biological stats and duration markers, ensuring numbers command visual hierarchy without relying on monospaced detachment.

## Layout & Spacing

The layout philosophy follows a disciplined **bento grid structure** that prioritizes white space as an active design component:

- **Desktop (1024px+)**: 12-column layout with max-width constrained to `1280px` for optimal eye travel. Margins are set at `margin-desktop` (3rem), with `gutter-lg` (2rem) between major modules. Bento tiles span 4, 6, 8, or 12 columns.
- **Tablet (768px - 1023px)**: 8-column layout with 2rem margins and 1.5rem gutters. Dual-pane widgets stack or collapse into 4-column balanced pairs.
- **Mobile (<768px)**: 4-column layout with `margin-mobile` (1.25rem) and `gutter-sm` (1rem). Multi-column bento modules reflow into a clean vertical stream.

### Spacing Principles
- Whitespace is uncompressed. Padding inside bento cards must not drop below `space-lg` (1.5rem) on tablet and desktop.
- Structural module gaps (`space-xl`) keep telemetry, scheduling, and protocol information visually decoupled to prevent cognitive overwhelm.

## Elevation & Depth

Visual hierarchy uses **tonal layering and ambient diffused shadows**, avoiding stark drop-shadows:

- **Canvas to Card**: The base porcelain floor (`#F8F9FA`) hosts pure white (`#FFFFFF`) cards. These cards are elevated with an ultra-soft shadow: `0 8px 30px -4px rgba(17, 24, 39, 0.04), 0 2px 6px -1px rgba(17, 24, 39, 0.02)`.
- **Low-Contrast Outlines**: Cards and inputs incorporate an airy perimeter stroke: `1px solid rgba(17, 24, 39, 0.05)`. This ensures edge clarity in high-glare environments without harsh demarcations.
- **Interactive Depth**: On hover or active state, cards do not lift aggressively; instead, their shadow expands into a warm matcha ambient aura: `0 14px 36px -6px rgba(5, 150, 105, 0.08), 0 0 0 1px rgba(5, 150, 105, 0.15)`.
- **Modals & Overlays**: Floating sheets and dialogs use a soft backdrop blur (`backdrop-filter: blur(12px)`) with a translucent white veil (`rgba(248, 249, 250, 0.8)`) to preserve ambient room light.

## Shapes

The interface adheres to **Level 2 (Rounded)**:

- **Bento Cards & Containers**: Set with `rounded-xl` (1.5rem / 24px) to produce soft, pebble-like surfaces that feel organic and inviting.
- **Buttons & Control Inputs**: Standard elements use `rounded-lg` (1rem / 16px) for an ergonomic, tactile hand feel. Small tags and status pills use a full pill radius (9999px) for friendly contrast against boxy layouts.
- **Form Fields**: Balanced at `0.75rem` (12px) to keep input frames clean, structured, and easy to parse.

## Components

### Buttons
- **Primary**: Solid Matcha Emerald (`#059669`) background, pure white text, semi-bold typography. Minimum height `48px`, padding `0 24px`, radius `rounded-lg` (16px). Hover induces subtle lightening (`#10B981`) and subtle glow.
- **Secondary**: Crisp white card surface, `1px solid rgba(17, 24, 39, 0.1)`, obsidian text (`#111827`).
- **Ghost/Tertiary**: Transparent background, text `#059669`, with light matcha hover tint (`rgba(5, 150, 105, 0.08)`).

### Bento Cards
- Pure `#FFFFFF` surface on `#F8F9FA` background with `1px` subtle border and ambient shadow.
- Inner padding: `24px` on mobile, `32px` on desktop.
- Header zone: Features subtle tracking category labels paired with optional icon glyphs enclosed in organic circular badges.

### Chips & Status Badges
- **Status Indicators**: Compact pill shapes (radius 9999px), `padding: 4px 12px`.
  - *Optimal/Active*: Background `rgba(5, 150, 105, 0.1)`, Text `#059669`, leading filled dot (6px).
  - *Calm/Neutral*: Background `rgba(17, 24, 39, 0.05)`, Text `#475569`.
  - *Caution*: Background `rgba(244, 63, 94, 0.1)`, Text `#E11D48`.
- **Filter Chips**: Resting state `#FFFFFF` with muted border. Selected state filled `#111827` with white text.

### Form Inputs
- Background `#FFFFFF`, height `52px`, `padding: 0 18px`, border `1px solid rgba(17, 24, 39, 0.1)`.
- Focus State: Border color `#059669` with outer ring `0 0 0 3px rgba(5, 150, 105, 0.12)`. No harsh dark borders.
- Labels: Placed strictly above inputs in `label-md`, obsidian ink with secondary helper text in `body-sm`.

### Checkboxes & Radios
- Size: `20px x 20px`. Radios are fully circular; checkboxes use `6px` corner radius.
- Unchecked: `#FFFFFF` fill with `1.5px` border (`#CBD5E1`).
- Checked: `#059669` fill with centered white check or dot mark, accompanied by gentle micro-spring scale animation.

### Telemetry & Biometric Gauges
- Minimalist circular tracks with `#E2E8F0` backgrounds and dynamic `#059669` progress strokes.
- Central typography displays the value via `numerical-metric` token with unit metrics set in `label-sm` underneath.