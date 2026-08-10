# Show HN draft (English)

> AI-generated draft. **Rewrite in your own voice before posting, and verify every claim yourself.**
> The posting action is the maintainer's — nothing here is auto-published.
> Channel discipline: `docs/launch-runbook.md` Phase E. Verifiable-claims rule: `docs/decisions.md` D3.
>
> ⚠️ **One claim needs your decision before posting** — see "五秒问题" at the bottom of this file.

---

## Title (draft)

```
Show HN: Eigentime – A local-only time logger PWA with no build step and no dependencies
```

Alternatives:
- `Show HN: Eigentime – Log what you actually did, in one line, offline`
- `Show HN: A zero-dependency PWA that tracks where your day actually went`

## Body (draft)

I kept being unable to answer "what did I actually do yesterday?" My calendar had a few meetings, but the hours between them — how long I wrote code, how long I scrolled, how long I sat there doing nothing — were unreconstructable after the fact.

Automatic trackers can tell me "2 hours in a browser." They can't tell me whether those two hours were preparing for an interview or avoiding preparing for an interview. That distinction is the whole point, and only I can supply it, in the moment, in one line of text.

So Eigentime logs the sentence, not just the stopwatch. Every span gets a few words and a tag, and the tags roll up into four buckets:

- **Focus** — the thing you're actually trying to move forward
- **Upkeep** — sleep, meals, commute, chores; necessary, not failure
- **Drift** — time that drifted off your main line. Deliberately not a moral category; sometimes drifting is the correct thing to do
- **Unlogged** — gaps you never recorded

**Unlogged is shown, not smoothed away.** Minutes are the authoritative unit; percentages are display-only and are never padded to make the day add up to 100%. A day with a four-hour hole in it looks like a day with a four-hour hole in it.

### Technical

- Plain HTML/CSS/JS. **No build step, no framework, no bundler, no runtime dependencies.** Native `type="module"` ES modules, served as static files. npm exists in the repo only for Playwright and `tsc --checkJs`; neither ships to a browser.
- Data lives in `localStorage`. No account, no server, no sync, no analytics, no third-party scripts, no cookies.
- Service Worker gives cache-first offline use. Installed to a home screen it opens and records with no network at all.
- Full backup is a JSON file you can copy, download, or share at any time — free, no account, works offline. Import re-validates every entry and makes you resolve conflicts one by one; it never silently merges.
- Timestamps are local wall-clock values with no timezone conversion. Moving between devices in different zones, import can offer a whole-backup ±N hour shift that you confirm.
- AGPL-3.0-or-later.

### Honest limitations

- **Built by one person, used daily by that person for 40+ days. It has not been validated with anyone else.** I have no idea yet whether it's useful to you.
- Service Worker cache is best-effort browser storage, not a permanent install. If you clear site data or the OS reclaims storage, it's gone — which is why the export button is one tap from the main screen and why I keep saying "export a backup."
- No sync, no accounts, no cloud, and none are planned. Two devices means two datasets plus an export/import.
- The UI was Chinese-only until a few days ago. The English translation is new; if something reads badly, that's on me and I'd like to hear about it.

Site: https://time.eigentime.org/en/
App: https://time.eigentime.org/app/
Source: https://github.com/wowayou/time-logger

---

## Notes for the poster

**Do this before you post:**

1. Rewrite the above in your own voice. HN readers detect ghost-written copy instantly, and this is a draft written by a model, not by you.
2. Verify every factual sentence against the current build. Especially the technical bullets — don't trust a version number written in this draft; check `https://time.eigentime.org/app/manifest.webmanifest` on the day you post.
3. Be around for the first few hours. On Show HN the comments are the point; a post that gets questions and no answers reads worse than no post.
4. Do **not** add user counts, testimonials, or any "loved by / trusted by" phrasing. There aren't any users to cite, and the repo has an audit guard that fails the build over exactly those phrases on the public pages.
5. Do not attach screenshots of your real timeline. The only allowed images are the fixed demo-data PNGs in `docs/assets/`.

**Likely questions, with honest answers ready:**

- *"Why not just use <existing tracker>?"* — Because automatic trackers measure applications, not intent. Answer from your own experience, not from a feature table.
- *"What happens when you lose interest?"* — It's static files under AGPL. Fork it, host it, the export format is plain JSON. Say that plainly; don't promise maintenance you can't promise.
- *"Why no sync?"* — It's a deliberate boundary, not a missing feature. `docs/decisions.md` D8 has the reasoning if you want to link it.
- *"Isn't manual logging too much friction?"* — This is the real objection and you should not dodge it. Your honest answer is that it's a bet: the entry has to be cheap enough that you actually do it, and that's exactly the thing that isn't proven yet.

---

## 五秒问题（发帖前必须自己决定）

对外文案（landing、README）用的定位句是 **"Log what you actually did, in five seconds."**

但 `CLAUDE.md` 的产品硬约束里写得很清楚：第五条「约 5 秒完成一次记录」**当前未达标，是军令状而非现状**。

也就是说：如果这句话在 HN 上被当成**已实现的性能声明**，它现在还站不住。而 HN 的读者一定会实测。

三个出口，你选一个：

1. **改成目标句**（本草稿采用的口径）：正文里不出现"五秒"，标题也不用它。上面的标题/正文已经按这个写好了，可以直接用。
2. **明确标成目标**：写 "the goal is to make one entry take about five seconds — it's not there yet"。这在 HN 是加分项，那里的人喜欢诚实的未达标。
3. **先实测再决定**：自己掐表记 10 条，拿到中位耗时。如果确实接近 5 秒，那就可以说；如果是 15 秒，就别说。

**我不替你决定这一条**——它取决于你愿不愿意先花十分钟测一次。但「landing 上写着、发帖时被追问却答不出」是最差的那种结果。
