# SMOKE — Privacy Policy

**Draft.** Not yet reviewed by a lawyer and not yet published. The contact
address is a placeholder until the domain is live.

*Last updated: 15 August 2026*

---

## The short version

SMOKE knows roughly which 50-kilometre square you lit your fire in, the messages
you send, and who is in your flock. It does not track you, does not sell
anything, contains no advertising, and has no third-party analytics of any kind.

Your messages are stored on our server and are **not** end-to-end encrypted. We
say that plainly here because it is true, and because an app that implied
otherwise would be lying about something that matters.

---

## What we collect

### Your phone number

Used only to sign you in. We never display it to anyone, never share it, and
never use it to help other people find you. Other users see you by the handle you
choose.

### Where your fire is — a 50 km square, not your location

This is the part worth reading carefully, because it is the part most apps get
wrong.

When you set up your account you place your fire. We store **the 50-kilometre
grid cell it falls in** — not your coordinates, not your address, not a live
position. "Somewhere around Newark" is the resolution.

- **We do not track your movement.** Your fire stays where you put it until you
  choose to move it. There is no background location, and the app never asks for
  your position while it is closed.
- **Your flock can see your approximate area**, because your smoke has to come
  from somewhere and travel somewhere. Anyone you have accepted into your flock
  can see roughly which city-scale region your fire is in. That is not a side
  effect — it is what the product is, and you should decide whether you want that
  before you accept someone.
- **Nobody outside your flock can see anything.** People cannot search for you by
  location, cannot be suggested to you by proximity, and cannot see your fire
  unless you accepted them.

### Your messages

We store the text you send, the route the smoke took, and what happened to it
along the way. Messages are stored **unencrypted at rest on our server** — they
are not end-to-end encrypted, and we can technically read them.

We do not read them. We do not analyse them, train anything on them, or use them
for advertising. But "we choose not to" is a weaker promise than "we cannot", and
you deserve the accurate one.

### Your flock

Who you have added, who has added you, who you have blocked, and who you have
reported.

---

## What we do not collect

- **No analytics SDK.** Not Google Analytics, not Firebase, not Amplitude, not
  anything. There is no third-party code in this app watching what you do.
- **No advertising, and no advertising identifiers.**
- **No contact-list access.** We never ask for your address book.
- **No background location.**
- **No tracking across other apps or websites.**

We do keep server-side operational records — that a message was sent, delivered,
stranded — because the app cannot function without them and because they are what
the Ledger shows you.

---

## Who can see what

| | You | Your flock | Strangers | Us |
|---|---|---|---|---|
| Your handle | yes | yes | no | yes |
| Your fire's ~50 km area | yes | yes | no | yes |
| Your phone number | yes | **no** | no | yes |
| Messages you send | yes | recipient only, after delivery | no | technically yes |
| Your flight map | yes | recipient, after delivery | no | yes |
| Who you blocked | yes | **no** | no | yes |

A recipient sees nothing about a message until it lands. No previews, no "so and
so is sending you something", no notification that smoke is on its way.

---

## Blocking and reporting

You can block anyone at any time. A block is immediate and mutual: neither of you
can send to the other, and they are not told.

You can report a message or a person. Reports go to a human — us — and are
reviewed within 24 hours. We may read a reported message; that is the point of
reporting one. Serious cases may lead to an account being removed.

To report abuse outside the app, or to raise anything urgent:
**support@smokebound.app** *(placeholder pending domain)*.

---

## Deleting your account

Ask us at **support@smokebound.app** and we will delete your profile, your
messages, your flock and your fire. Messages you already sent that were delivered
may remain in the recipient's Ledger — we cannot reach into someone else's
copy — but they will no longer be linked to your account.

We have not yet built self-service deletion in the app. We will before general
release, and this policy will be updated when we do rather than beforehand.

---

## Children

SMOKE is not intended for children under 13, and we do not knowingly collect
anything from them.

---

## Where your data lives

On servers in the United States, operated by Supabase (our database host) and
Expo (push notifications). Weather data comes from the US National Weather
Service, which receives grid coordinates — never anything about you.

---

## Changes

If this policy changes in a way that affects what we collect or who can see it,
we will say so in the app before the change takes effect, not after.

---

## Contact

**support@smokebound.app** *(placeholder pending domain)*

---

### For reviewers

- Location is **coarse and foreground-only**, collected at registration and when
  the user explicitly moves their fire. Declared in the App Store privacy labels
  as coarse location, used for app functionality, not linked to advertising.
- Messages are stored server-side and **no end-to-end encryption is claimed**
  anywhere in the app, the marketing, or this policy.
- Blocking, reporting and a 24-hour moderation response are implemented in the
  app, per App Store guideline 1.2.
