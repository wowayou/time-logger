# Lobste.rs draft (English)

> AI-generated draft. **Rewrite in your own voice before posting, and verify every claim yourself.**
> The posting action is the maintainer's — nothing here is auto-published.
> Channel discipline: `docs/launch-runbook.md` Phase E. Verifiable-claims rule: `docs/decisions.md` D3.
> The five-second caveat in `en-show-hn.md` applies here too.

---

## ⚠️ Read this before considering Lobsters at all

Lobste.rs is **invite-only** and has a much stronger anti-self-promotion norm than HN. Two hard rules:

- You must tag the submission `authored by me` (or `show`) when it's your own work.
- Submitting your own project as your first or near-first contribution is the fastest way to get downvoted and remembered badly. If you don't already have an account with a history there, **skip this channel** — it costs more than it returns.

If you do have standing there, the angle below is the one that fits the site's culture. **It is not "here is my app."** It's "here is an engineering decision and what it cost."

---

## Option A — submit the project (only if you have standing)

**Title:** `Eigentime: a PWA with no build step, no framework, and no runtime dependencies`

**Comment to attach (required — Lobsters expects context on self-authored links):**

> A time logger I built for myself. The part I think is interesting here isn't the product, it's the constraint: it's ~9 ES modules served as static files, with no bundler, no framework, and no runtime dependencies at all. npm is in the repo purely for Playwright and `tsc --checkJs`; nothing from it reaches a browser.
>
> Holding that line for 78 versions has been the actual experiment. What it bought: no build, no dependency churn, no supply chain, and a repo that will still run in five years. What it cost: hand-rolled everything, including a wheel time picker and an i18n layer, and a governance document that has grown to include red lines I keep re-learning the hard way.
>
> Data is local-only (`localStorage`), no accounts, no server, no telemetry. AGPL-3.0-or-later.

## Option B — write the dev-story post instead (recommended)

`docs/decisions.md` D3 already reached this conclusion for English channels: **the engineering story travels better than the app**. That was decided when the UI was Chinese-only. The UI is English now, so Option A is at least possible — but B is still the stronger play for this audience, and it works on HN too.

Candidate topics, in the order I'd rank them by how much genuinely-earned material exists:

1. **"Every guard rail in this repo exists because something broke."** The audit script has ~20 assertions and most map to a specific postmortem. Concrete examples: a `.gitignore` rule that matched nothing for weeks because the real directory name had a trailing space (rule present, never effective — worse than no rule); `reuseExistingServer: true` making a whole test suite silently test a stale server; a boot snapshot restoring a previous *version's* DOM into new JS.

2. **"Prove the test fails before you claim it passes."** The repo's P35 rule: no regression test is accepted without first demonstrating it goes red. Real payoff from this week: an i18n guard rail caught two full-width Chinese punctuation marks that a human pass had missed, and a migration guard needed *two* opposing tests because the one-directional version could be satisfied by hardcoding the answer.

3. **"Translating a UI is mostly deciding what isn't UI."** The i18n work's hard part wasn't translation — it was discovering that some strings were data: a reserved tag name that was a config key travelling in user backups, and default tag seeds that must never be re-translated for an existing install. Translating them would have made old backups unreadable.

4. **"The upgrade that silently changed everyone's language."** Adding a second locale activated a `navigator.languages` branch that had been dead code for the app's entire life, which would have flipped every existing user with an English browser to an English UI. Small, sharp, and generalizable to any "we only had one X" assumption.

Any of these is a real post with real artifacts behind it. **None of them require the reader to care about the product**, which is exactly why they work in English engineering communities.

---

## Notes for the poster

1. If you write the dev-story (B), publish it on your own site and submit *that*. A blog post about a decision is a contribution; a link to your product is an ad.
2. Don't oversell the zero-dependency thing as universally correct. It's a fit-for-this-project choice with real costs, and this audience will respect "here's what it cost me" far more than "here's why you should do it too."
3. Every code claim must be checkable in the public repo — this audience will actually look.
4. No user numbers, no adoption claims, no screenshots of real data.
