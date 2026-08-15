# SMOKE — credentials and rotation

Operational runbook. Written during M5.7 after a database password was disclosed
in a working session.

---

## Standing audit: what is in the repository

Checked across **all 31 commits, every blob**, not just the working tree:

| Searched for | Found in git history |
|---|---|
| The disclosed database password | **no** |
| Supabase anon key (`eyJhbGciOiJIUzI1NiIs…`) | **no** |
| Supabase project ref (`hypfksdvkwtaezchzixb`) | **no** |
| Session-pooler hostname | **no** |
| `.env`, `apps/mobile/.env`, `services/engine/.env` | **never tracked** |

`service_role` appears in the source, but only as the name of a Postgres role in
test scaffolding and in a README table — a role name, not a key.

**No history rewrite is required.** No `filter-repo`, no BFG, no force-push. That
matters beyond convenience: a force-push rewrites every commit hash, breaks every
clone, and invalidates every link in the session logs — a real cost that would
have been worth paying, and is not being paid because it is not needed.

`.gitignore` covers `.env` and `.env.*` with an exception for `.env.example`, and
both example files contain placeholders only.

### Reproducing the audit

```bash
git grep -IE "<secret>" $(git rev-list --all)     # every blob in every commit
git log --all --oneline -- .env apps/mobile/.env  # was it ever tracked?
git status --porcelain --ignored | grep '\.env'   # present but ignored
```

---

## Why the password still must be rotated

The repository is clean; the **disclosure** still happened. The password was
typed in plaintext into a working session, which means it exists in a transcript,
in whatever logs that transcript passes through, and in the scrollback of at
least one terminal.

A secret's blast radius is where it has *been*, not where it is stored. Rotate.

---

## Rotation — steps the owner performs by hand

The engine cannot do this: it requires dashboard authentication, and the new
secret must never travel through a tool that logs its arguments.

### 1. Reset the password

Supabase dashboard → **Settings → Database → Database password → Reset database
password**. Generate a strong one and copy it once.

This invalidates the old password immediately. Anything using it stops working
until step 2 — which is a few minutes of engine downtime, not data loss. Nothing
in flight is harmed: message state lives in Postgres, and the engine resumes
where it left off (`eta` is an absolute timestamp; a message past its ETA settles
on the next delivery-check tick).

### 2. Update the environment on the home server

One file holds it:

```
~/Smokebound/.env        → DATABASE_URL
```

The connection string is the **session pooler**, not the direct host — the direct
host is IPv6-only and this machine has no IPv6 route:

```
postgresql://postgres.<project-ref>:<NEW-PASSWORD>@aws-0-us-west-2.pooler.supabase.com:5432/postgres
```

If the password contains `@`, `/`, `#`, `?` or `:`, **percent-encode it** or the
URL parses wrong in a way that produces a confusing authentication error rather
than a parse error.

Edit it in an editor. Do not `echo` it on a command line — shell history is one
more place it lives.

```bash
chmod 600 ~/Smokebound/.env      # confirm, should already be 600
```

`apps/mobile/.env` does **not** need changing: it holds the project URL and the
anon key, neither of which is derived from the database password.

### 3. Restart the engine

```
Terminal 1:  Ctrl+C, then  npm start -w services/engine
```

Watch for `engine up (transport: table)`. A wrong password shows as a connection
error on the first query, immediately — not silently.

### 4. Verify

```bash
npm run db:seed          # touches nothing, but must connect and validate config
```

Expected: `mechanics_config loads cleanly through the strict config loader.`

---

## Which credentials exist, and what each one can do

| Credential | Where it lives | Blast radius if leaked |
|---|---|---|
| **Database password** | `.env` → `DATABASE_URL` | Total. Full read/write on every table, bypassing RLS. Rotate on any suspicion. |
| **Supabase anon key** | `apps/mobile/.env`, and shipped in the app | **Public by design.** It is in every installed binary. RLS is what protects the data; the key alone grants nothing. |
| **`PREVIEW_TOKEN_SECRET`** | `.env` | Forged preview tokens — a user could send with a quoted ETA the engine never issued. Rotating it invalidates outstanding previews (10-minute TTL), so the cost is one awkward minute. |
| **`SUPABASE_JWT_SECRET`** | `.env`, only when the HTTP transport is on | Forged user sessions. Currently unused — the launch transport is table-based. |
| **`SUPABASE_SERVICE_ROLE_KEY`** | `.env`, currently unset | Total, same as the database password. Do not set it unless something needs it. |

---

## Rules

- **Never paste a secret into a chat, an issue, or a commit message.** The
  transcript outlives the intention.
- **Never `echo` a secret on a command line.** Shell history, process listings.
- `.env` stays `chmod 600` and untracked, always.
- The anon key is public; treat every other row above as radioactive.
- After any rotation, re-run the audit at the top of this file. It takes seconds
  and it is the only way "we rotated it" becomes "we checked".

---

## If a secret ever *does* reach git history

Not the case today. Recorded so nobody has to work it out under pressure.

1. **Rotate first.** A scrubbed history does not un-leak a live credential, and
   every minute spent rewriting history is a minute the old secret still works.
2. Scrub with `git filter-repo --replace-text` (preferred) or BFG.
3. **Force-push requires owner sign-off.** It rewrites every commit hash: clones
   break, open branches must be rebased, and links to old commits die.
4. GitHub caches unreferenced objects; open a support request to purge them, or
   treat the secret as permanently public and rely on step 1.
