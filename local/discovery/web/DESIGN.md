---
name: Career-ops Internship Desk
description: The implemented visual system for the local internship discovery browser.
colors:
  bg: "#f7f6f3"
  surface: "#fff"
  hover: "#efeeea"
  line: "#dedbd4"
  ink: "#1f1c19"
  muted: "#625c53"
  brand: "#dd7627"
  brand-hover: "#ff9f33"
  brand-ink: "#281c15"
  accent: "#a65012"
  selected: "#fbf1e7"
  success: "#2f6149"
  warning: "#79520b"
  warning-bg: "#fbf5e8"
  danger: "#953d30"
  filter-bg: "#fcfbf9"
  row-hover: "#faf9f6"
  warning-line: "#decca0"
  success-line: "#bdd1c4"
  positive-bg: "#f1f7f3"
  success-bg: "#eff6f1"
  error-bg: "#fcf0ed"
  error-line: "#e6bfb7"
typography:
  headline:
    fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif'
    fontSize: "32px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-.025em"
  title:
    fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif'
    fontSize: "25px"
    fontWeight: 650
    lineHeight: 1.28
    letterSpacing: "-.025em"
  row-title:
    fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif'
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.45
  body:
    fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif'
    fontSize: "14px"
    fontWeight: 400
  description:
    fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif'
    fontSize: "12px"
    fontWeight: 400
rounded:
  tag: "4px"
  field: "6px"
  control: "8px"
  workspace: "12px"
spacing:
  tight: "4px"
  small: "8px"
  compact: "12px"
  standard: "16px"
  row: "20px"
  group: "24px"
  section: "28px"
  page: "36px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.brand-ink}"
    rounded: "{rounded.control}"
    padding: "12px 18px"
  button-primary-hover:
    backgroundColor: "{colors.brand-hover}"
    textColor: "{colors.brand-ink}"
  button-text:
    textColor: "{colors.accent}"
    rounded: "0"
    padding: "4px 0"
  input-search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "9px 10px"
  select:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "7px"
  track-tab:
    textColor: "{colors.muted}"
    padding: "10px 0"
  track-tab-selected:
    textColor: "{colors.accent}"
  tag:
    textColor: "{colors.muted}"
    rounded: "{rounded.tag}"
    padding: "3px 7px"
  tag-review:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning}"
    rounded: "{rounded.tag}"
    padding: "3px 7px"
  tag-positive:
    backgroundColor: "{colors.positive-bg}"
    textColor: "{colors.success}"
    rounded: "{rounded.tag}"
    padding: "3px 7px"
  job-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    padding: "19px 20px"
    width: "100%"
  job-row-selected:
    backgroundColor: "{colors.selected}"
  workspace:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.workspace}"
  review-section:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning}"
    rounded: "{rounded.control}"
    padding: "17px 18px"
  notice-error:
    backgroundColor: "{colors.error-bg}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "15px 18px"
---

# Design System: Career-ops Internship Desk

## Overview

**Creative North Star: "The familiar internship desk"**

A quiet local workspace for scanning roles, inspecting their evidence and returning to the list. Warm neutral surroundings, white working surfaces and restrained orange actions carry the existing Career-ops visual vocabulary into familiar browser controls. Precision and readable density supply the character.

This document applies only to `career-ops/local/discovery/web`. The visual authority is the implemented `index.html`, `style.css` and `app.js`, checked against the desktop and mobile review captures. It inherits the warm background, white surfaces, orange action family and dark action text from [the upstream Career-ops stylesheet](../../../web/src/app/globals.css). Local literals are the source of truth for this surface; they do not redefine the upstream system. The local system uses Windows system UI type and a light theme. It does not import the upstream marketing serif, olive landing treatment, dark theme or decorative animation.

**Key Characteristics:**

- Flat, bounded working surfaces with thin warm dividers.
- Strong role titles, tabular scores and quiet supporting evidence.
- Orange for primary actions, current selection and keyboard focus.
- Explicit text for source state, uncertainty and incomplete data.
- A simultaneous desktop list/detail view and a mobile list-to-detail path.

## Colors

The palette is warm and neutral, with one orange action family and functional status colors. The frontmatter records the exact implemented values.

### Primary

- **Brand orange** (`brand`): solid Refresh listings and Open original listing actions; use the dark `brand-ink` foreground.
- **Light orange** (`brand-hover`): the primary action hover state.
- **Deep orange** (`accent`): small links, selected tab labels and rules, the selected role title, focus outlines and the small brand icon.
- **Pale orange** (`selected`): the full current result row, so selection remains visible beyond its title.

### Neutral

- **Warm page** (`bg`) and **white surface** (`surface`): page surroundings and working panels.
- **Quiet hover** (`hover`): initial loading blocks. `row-hover` is the lighter result hover surface.
- **Warm divider** (`line`): panel boundaries, row separators, fields and evidence rules.
- **Near-black ink** (`ink`): headings and primary content. **Warm gray** (`muted`): employers, location, timestamps, source notes and control labels.
- **Filter wash** (`filter-bg`): separates the control band from both the tabs and results.

### Functional status

- **Forest green** (`success`): local service indicator, positive evidence and successful completion. Positive tags and success notices use their separately implemented `positive-bg` and `success-bg` fills with `success-line`.
- **Amber brown** (`warning`): unresolved requirements, review/excluded tags and review panels, paired with `warning-bg` and `warning-line`.
- **Brick red** (`danger`): failed or partially failed refresh and connection notices, paired with `error-bg` and `error-line`.

**The Action Ink Rule.** Keep the dark foreground on orange primary actions; use the deep orange accent for small action text.

**The Evidence Rule.** Status color accompanies a readable label or message. Green is an observed positive signal; amber retains an unresolved question.

## Typography

**Body and heading font:** Segoe UI, then system-ui, -apple-system and sans-serif. No web font is requested.

The system UI stack suits a Windows task workspace. Semibold headings and row titles provide hierarchy without a separate display face. The stylesheet sets a base body size (14px); several secondary reading roles explicitly use (13px). The smallest explicit metadata and control-label size is (12px), including source observation timestamps.

### Hierarchy

- **Headline:** the frontmatter `headline` role; mobile reduces it to (27px).
- **Selected role title:** the `title` role; mobile reduces it to (23px).
- **Result title:** the `row-title` role, with wrapping for long names.
- **Section heading:** (15px, weight 650).
- **Body and primary controls:** the `body` role; paragraph line-height is (1.6).
- **Secondary reading:** descriptions use the `description` role and a maximum measure (72ch). Fit/review lists use (13px, line-height 1.65). Detail employer and location use (13px); the mobile introduction also uses (13px).
- **Labels and metadata:** the `label` role, with weights (400), (500) or (550) according to hierarchy. Tags and source notes keep readable line-height (1.5–1.6).
- **Scores:** list values use (14px, weight 650); the selected score uses (27px, line-height 1), reduced to (24px) on mobile. Counts, scores and timestamps use tabular numerals where implemented.

**The Reading Floor Rule.** Preserve the implemented 12px metadata floor. Do not allow browser-default `small` sizing to shrink source timestamps below it.

## Layout

The page has a maximum width (1580px), centered with desktop horizontal padding (36px). A white top bar (72px high) spans the viewport. The heading aligns the introduction with the right-aligned Refresh action; a narrow context line and compact metrics precede the bounded workspace.

The workspace groups track filters and export, then search and native form controls, then the result list and selected detail. Desktop columns are `minmax(310px, 39%) minmax(0, 1fr)`. The list scrolls independently at (690px), and detail at (738px), including the list heading's corresponding vertical allowance. Detail padding is (28px 30px); rows use (19px 20px). Content groups use roughly (20–28px) separation; the actual spacing steps are captured above rather than forced into a new scale.

- **At widths of at least 1500px:** list/detail heights increase to (740px/788px).
- **At widths up to 1150px:** page and top-bar horizontal padding becomes (24px); detail padding becomes (24px); columns become `minmax(295px, 41%) minmax(0, 1fr)`. Filters wrap, and the Spring Boot checkbox can move to the right.
- **At widths up to 760px:** the top bar becomes (60px), page horizontal padding (16px), and the heading stacks. Tracks form a single horizontally scrollable line; export sits below them. Search fills its own row, selects wrap, and the checkbox has its own row.
- **Mobile selection:** the list flows with the page. Selecting a result hides the list and reveals an auto-height detail panel with Back to opportunities. Back restores and focuses the results region. The original-listing action spans the detail width. Diagnostics and footer stack.

Long employer names, titles, URLs and source descriptions wrap rather than dictate column width. Descriptions preserve source line breaks. The desktop detail reserves its scrollbar gutter; neither desktop pane uses a decorative overlay or floating card.

## Elevation & Depth

This surface has no box shadows. Depth comes from the warm page, white panels, lightly tinted filter/selected/status surfaces and single-pixel borders. Hover changes color without moving or lifting elements. Keyboard focus uses a deep-orange outline (2px) with offset (3px); the search container uses the same outline at offset (1px).

State transitions affect button and link background/text colors (160ms ease). Only the refresh icon rotates (1.4s linear, infinite) while the runner is active. Initial loading blocks are static. The reduced-motion query removes animations and transitions and restores automatic scrolling. No motion communicates an invented completion percentage.

## Shapes

The workspace has the broadest corners (12px). Primary actions and status/review panels use (8px); search fields, native selects and loading blocks use (6px); evidence tags use (4px). Result rows are flush rectangular targets separated by thin rules. Track selection uses a bottom rule (2px), not a pill. The small local-status dot is circular (6px); it is the only recurring circular signal.

SVGs use simple outlined geometry. Standard icons are (20px); action/detail icons are (16px), export (17px), and the wordmark mark (30px). Corners, borders and icon scale support the controls rather than introduce a new identity.

## Components

### Primary and text actions

Solid orange actions use semibold type (650), inline icons, (8px) gaps and the frontmatter padding/radius. Hover uses the lighter orange. Disabled refresh has opacity (.65) and a wait cursor. While active, its label changes to Refreshing… and its icon rotates; no second active run is offered. Small text actions use the deep orange and an underline. All retain visible keyboard focus.

### Track navigation

Track controls are buttons in a named group, with `aria-pressed` on the chosen track. Unselected labels are muted and darken on hover; selection uses the accent text and bottom border. Counts reflect the current search, Show, Source and Spring Boot filters while ignoring the selected track itself. The desktop minimum target height is (59px), mobile (52px).

### Search and filters

The search is a white outlined field with a leading icon, a (13px) input and a container focus outline. Its flexible basis is (230px), with minimum width (190px); mobile gives it a full row. Native selects preserve familiar affordances at a minimum height (38px). Visible labels and an accessible search name identify the controls. The checkbox uses the deep-orange accent and a (15px) native input.

### Result rows and tags

Every result is a full-width button. Employer and score lead; a stronger title follows, then location and wrapping evidence tags. Hover uses the subtle row wash. The current row has `aria-current`, a pale-orange surface and an accent title. Tags remain compact bordered rectangles: neutral for track/source count, green for explicit Spring Boot evidence, amber for review, exclusion and possible duplicate uncertainty.

### Selected role and evidence

The title, employer, location and numeric score establish identity before actions. Fit evidence, score breakdown, questions to confirm, source description and observation history follow as distinct groups. The question panel uses amber fill with readable text and bullets. Sources remain linked text with timestamps; deduplication evidence uses a native disclosure. Source material is rendered as text and preserves line breaks.

### Notices and refresh progress

Notices use a tinted surface, thin matching border and an explicit message. Error notices can include Reload data. A partial source failure is visible while saved records remain usable. During refresh, a bordered white progress panel shows text states for company sources and JobSpy. The saved list stays available, and completion reloads data while retaining filter values.

### Loading, empty and unavailable states

The initial list contains three static neutral loading blocks (145px high). Missing saved data receives a clear Refresh instruction. No filter matches receives a centered message and Clear filters action, with a specific message for Spring Boot filtering. A missing description directs the reader to the original listing. Connection failure retains the current view and exposes a recovery action. Empty detail prompts remain subdued and centered.

### Source diagnostics and supporting navigation

Coverage/source health is a native disclosure below the workspace, with its summary state visible while closed. Its open content uses two desktop columns and one mobile column; per-query diagnostics use an ordinary ruled table. The skip link appears on focus and targets results. External posting links open a separate tab with safe link attributes.

## Do's and Don'ts

### Do:

- **Do** preserve the inherited warm neutral/orange vocabulary and the local surface's system UI type.
- **Do** keep titles, scores, source evidence and unresolved requirements easy to distinguish.
- **Do** retain the 12px metadata floor, wrapping long content and visible keyboard focus.
- **Do** preserve list/detail behavior and the mobile back path when adding related states.
- **Do** show partial source failure while keeping saved results readable.

### Don't:

- **Don't** redefine the upstream Career-ops system from this isolated local document.
- **Don't** add a marketing identity, decorative typography, shadows or unrelated animation to this task workspace.
- **Don't** use color alone to imply verification or turn a fit score into a hiring probability.
- **Don't** erase excluded records, missing evidence or uncertainty to make the result list look cleaner.
- **Don't** add application submission, outreach, resume upload or scheduling controls to the discovery interface.
