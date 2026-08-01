# r/selfhosted draft (English)

> AI-generated draft. **Rewrite in your own voice before posting, and verify every claim yourself.**
> The posting action is the maintainer's — nothing here is auto-published.
> Channel discipline: `docs/launch-runbook.md` Phase E. Verifiable-claims rule: `docs/decisions.md` D3.
> The five-second caveat in `en-show-hn.md` applies here too.

---

## Title (draft)

```
Eigentime — a time logger that's just static files: no account, no server, no telemetry, host it yourself
```

## Body (draft)

I built this for myself and it turns out to be about as self-hostable as a web app gets, so it might belong here.

**What it is:** a PWA for logging what you actually did with your day, in one line per span. Not a stopwatch — the point is the sentence. Spans roll up into four buckets (Focus / Upkeep / Drift / Unlogged), and the gaps you never logged stay visible instead of being smoothed away.

**Why it fits this sub:**

- **It is literally static files.** No build step, no bundler, no framework, no runtime dependencies — plain HTML/CSS/JS with native ES modules. `git clone`, point any static file server at the directory, done. No Docker, no runtime, no reverse-proxy config, no database.
- **There is no server component to self-host**, because there is no server at all. Data lives in your browser's `localStorage`. No account, no login, no sync endpoint, no telemetry, no third-party scripts, no cookies.
- **Your data is a file.** Full backup exports as plain JSON — copy, download, or share it, any time, offline. Import re-validates every record and makes you resolve conflicts explicitly; it never silently merges or overwrites.
- **AGPL-3.0-or-later.** Fork it, host it, modify it.
- Works fully offline once cached (Service Worker, cache-first). Installed to a home screen it opens and records on a plane.

**Honest caveats, because this sub deserves them:**

- **This is single-device by design.** No sync, no accounts, no cloud — and none are planned. If you want the same timeline on your phone and laptop, that's an export and an import, manually. If cross-device sync is a requirement for you, this is the wrong tool and I'd rather you know now.
- **`localStorage` is browser storage, not a database.** Clear site data, uninstall the PWA, or let the OS reclaim storage, and it's gone. That's why I export backups regularly and why the export is one tap from the main screen. I'm not going to pretend browser storage is durable.
- **Built by one person, used daily by that person for 30+ days, never validated with anyone else.** No user base, no testimonials, nothing to cite.
- If you host the public copy rather than your own, note that any web host logs incoming requests (IP, user agent) as a transport-layer fact. The project doesn't touch, retain, or analyze those logs, and injects no identifiers — full disclosure at /en/privacy/. Self-hosting removes even that.

Site: https://time.eigentime.org/en/
App: https://time.eigentime.org/app/
Source: https://github.com/wowayou/time-logger

---

## Notes for the poster

1. **Rewrite in your own voice.** This sub is allergic to marketing tone, and it is right to be.
2. Check the sub's self-promotion rules before posting — several selfhosting communities require a flair, a disclosure that you're the author, or a minimum account age. Read the sidebar; don't get the post removed on a technicality.
3. Lead with the self-hosting angle, not the productivity angle. The people here care that it's static files and that nothing phones home. The time-tracking philosophy is secondary for this audience.
4. **Expect "why not just use a spreadsheet / Obsidian / a text file?"** That's a fair question and the honest answer is that a plain file doesn't give you the day's shape at a glance or the bucket rollups — but if someone's already happy with a text file, don't argue them out of it.
5. Do not post screenshots of your real timeline. Demo-data PNGs in `docs/assets/` only.
6. Do not claim any user numbers or adoption. There are none.
