# site — the landing page (LAUNCH.md §6)

Static HTML, no build step, no JavaScript, no external requests. GitHub-Pages
ready: point Pages at this directory and it serves.

- `index.html` — the one-pager: hero, the detour map, three moments, the history
  section, moderation contact, privacy link.
- `privacy.html` — generated from `../PRIVACY.md`, which is the source of truth.

## Why no framework

It is one page that must load on a phone over cellular, say what the app is, and
link to two things. Every dependency here would be a dependency to maintain for a
page that will change perhaps four times.

## Why no build step for the page itself

`privacy.html` is generated from `PRIVACY.md` so the policy has a single source
of truth — a privacy policy that differs between the site and the repository is
worse than one that only exists in one place. Regenerate it when the markdown
changes; the generator lives in the M5.7 commit and is small enough to re-derive.

## Assets

The map illustration is inline SVG rather than an image: it is sharp at any size,
it costs no request, and it uses the same palette tokens as the app so the two
cannot drift apart visually.

## Before this goes live

- `support@smokebound.app` is a placeholder in both pages and in PRIVACY.md.
  App Store guideline 1.2 requires a working moderation contact — it must exist
  and be monitored before submission, not after.
- The App Store button is `aria-disabled` and goes nowhere until there is a
  listing to point at.
