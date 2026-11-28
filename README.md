# Atlas

A general-purpose everyday agent — job search, mail, web research, tasks,
notes, files, planning, maths, anything you ask. Dark-first mission
console: near-black ink-blue canvas, one amber accent, a proper top bar
with a breadcrumb and a search button, a sectioned sidebar (Home,
missions, plans, reminders, notes, chats), and one wide centred chat
column. The tool trace is an inline timeline under each answer, plus an
overlay drawer on demand. Atlas opens on a Home overview — greeting,
today's open missions with progress, reminders, recent chats and notes,
and quick actions — all real data, all clickable.

Atlas is not a chat clone. It runs a real tool loop: the model decides
which tool to call, the app runs the tool in this browser, the real
result goes back to the model, and the answer is written from the result.
Every step shows in the trace under the answer.

Replies come from **Google Gemini**, using your own free API key. The app
ships with no key and never fakes a reply: without a key it tells you
plainly that a key is needed and where to get one.

## Run it

No build step. Open `index.html` in a browser, or serve the folder:

```bash
npm start        # python3 -m http.server 8000, then open http://localhost:8000
```

GitHub Pages-ready: the repo root is the site. The code is pushed to
`sivasaiboggu/atlas-agent` on `main`; enable Pages (Settings → Pages →
Deploy from a branch → `main`, `/(root)`) to put it live.

## First use (what Siva must supply)

1. Open **Settings** (bottom-left).
2. Paste a **free Gemini API key** from
   [Google AI Studio](https://aistudio.google.com/apikey) (free tier, no card).
3. Save. The key is stored only in this browser's local storage.

That is the only thing needed. No account, no server, no payment.

## What works

- **Agent loop with real tools** (`src/agent.js` + `src/tools.js`):
  - `web_search` — Wikipedia first, DuckDuckGo fallback; real titles,
    extracts and links.
  - `fetch_page` — reads a page's text (up to 8000 characters). When a
    site blocks the read, the trace says so and gives the URL — content
    is never invented.
  - `get_weather` — Open-Meteo, no key: geocodes the place, then the
    current conditions.
  - `tasks` — add, list, complete; saved in localStorage, shown in the
    left rail. Adding the same open task twice is refused.
  - `notes` — save, list, search; saved in localStorage, shown in the
    left rail; click one to read it.
  - `draft_email` — builds a Gmail compose link with to/subject/body
    filled in and opens it. **The app cannot send mail by itself** —
    the draft is reviewed and sent from Gmail, and the app says so.
  - `calculate` — arithmetic with a small safe parser (no `eval`).
  - `read_file` — reads a text file you attach with the paperclip
    button (.txt, .md, .csv, .json, .log, up to 20000 characters) and
    answers questions about it.
- **Live trace** — every turn shows the plan, each tool call with its
  arguments, the real result, and the final answer. Collapsible per
  message, and live in the inline timeline while Atlas works; the
  drawer (Trace button, top right) shows the last turn's full trace.
- **Mission plans** — when a request needs several tools, the answer
  carries a numbered plan card and each step is checked off as its
  tool runs (done, running, failed). Plans persist in the left rail
  with progress (e.g. 2 of 4); clicking one opens its chat. The plan
  is driven by the real tool loop — a step only ticks when its tool
  actually ran.
- **Command palette** — `Ctrl/⌘ K` (or the Search button): fuzzy search
  across chats, tasks, notes and tools, with counts per group; arrow
  keys to move, Enter to jump or run, Esc to close. Actions in the
  list: new chat, go home, settings, switch theme, back up data, and
  the common prompts.
- **Slash commands** — type `/` in the composer for a menu: `/search`,
  `/mail`, `/task`, `/note`, `/weather`, `/calc`, `/file`. Choosing one
  fills in the right tool call; `/file` opens the file picker.
- **Voice input** — the microphone button dictates into the composer
  through the browser's Web Speech API. When the browser does not
  support it, the app says so plainly instead of pretending.
- **Reminders** — type "remind me to … at …" in plain words ("remind me
  to call the bank at 6pm", "in 20 minutes", "tomorrow at 9am"). The
  reminder is stored in localStorage, listed in the left rail and on
  Home, and fires a browser Notification when it is due. **Reminders
  only fire while Atlas is open in a tab** — a static page cannot wake
  itself, and the app says that in the sidebar and in Settings.
- **Search everywhere** — the sidebar box searches chat titles and
  message text, tasks and notes, with grouped results and counts.
- **Drag-and-drop file attach** — drop a file onto the composer (or use
  the paperclip); the file chip shows the attached file and the
  `read_file` tool reads it.
- **Export / import** — Settings → "Back up data" downloads a JSON
  backup of chats, tasks, notes, plans, reminders and settings. The
  backup never includes the API key. "Restore from backup" (two-step
  confirm) replaces all local data with the file's contents.
- **Streaming replies** with token counts when Google reports them
  (real numbers, not estimates).
- **Markdown replies**: headings, bold/italic, links, lists,
  blockquotes, fenced code blocks with a language label and a working
  Copy button. All model output is HTML-escaped before rendering.
  Code blocks are capped to the column width, so long lines scroll
  inside the block instead of pushing the page sideways.
- **Stop generating** (AbortController), **regenerate** the last reply,
  **copy** any reply, **share** copies the chat as Markdown with a
  "Tools used" line per answer.
- **Sidebar history**: new chat, rename (inline), delete (two-step
  confirm), search across titles and message text. Everything persists
  in localStorage.
- **Model picker**: Gemini 3.8 Flash (default — Google's current Flash model, built for agents), Gemini 2.5 Flash, Gemini 2.0 Flash, Gemini 2.5 Pro. If a model is unavailable for your key, or the key is
  wrong, or quota is hit, the app shows Google's real error in plain
  words — it never invents an answer.
- **Quick actions**: Search the web, Draft a mail, What's the weather,
  Plan my day, Summarise a file, Manage tasks.
- **Keyboard**: `Ctrl/⌘ K` command palette, `Ctrl/⌘ ⇧ K` new chat,
  `Enter` send, `Shift+Enter` newline, `Esc` closes the palette, the
  slash menu, Settings, or stops a reply.
- **Dark first, light mode too**, same quality both ways. Mobile drawer
  sidebar at 390px; the trace rail becomes an overlay below 1200px.
- **Motion, restrained**: messages and trace steps fade in (200ms),
  rails slide (200ms), buttons press (150ms) — transform/opacity only,
  and `prefers-reduced-motion` turns it all off.
- **No AI-slop tells**: no sparkle emoji, no gradient orbs, no
  "seamless / supercharge / elevate" copy. Plain human words throughout.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | Shell: left rail (missions/notes/chats), chat, trace drawer, Settings + note modals |
| `styles.css` | Tokens (OKLCH + hex fallbacks), two-rail layout + trace drawer, dark + light |
| `tokens.json` | Design tokens + palette + references |
| `src/markdown.js` | Safe Markdown renderer (escape-first) |
| `src/store.js` | Conversation store (localStorage, testable) |
| `src/work.js` | Task + note stores (localStorage, testable) |
| `src/gemini.js` | Gemini streaming client + plain-language errors + functionCall parsing |
| `src/tools.js` | Tool registry, validators, executors (search, page, weather, tasks, notes, mail, maths, file) |
| `src/agent.js` | The agent loop: plan → tool calls → real results → final answer |
| `src/app.js` | UI wiring: rails, Home, palette, slash menu, voice, drag-and-drop, plans, reminders, backup/restore |
| `src/reminders.js` | Reminder parsing ("remind me to … at …") + reminder store |
| `src/plans.js` | Mission-plan store (steps, progress) + step labels |
| `src/search.js` | Fuzzy search across chats, tasks, notes (grouped, counted) |
| `src/slash.js` | Slash commands: parse, match, build |
| `src/palette.js` | Command-palette items: search groups + actions |
| `src/voice.js` | Web Speech dictation wrapper (injected Recognition, testable) |
| `src/backup.js` | JSON backup build / validate / parse (API key never included) |
| `tests/*.test.js` | `node --test` suites |
| `scripts/shots.mjs` | Headless-Chrome screenshots (CDP, file://) |
| `scripts/smoke.mjs` | Headless-Chrome smoke test of the new features (palette, slash, reminder, export, plan card, search) |
| `screenshots/*.png` | Desktop 1280px + mobile 390px, dark + light |

## Tests

```bash
npm test          # node --test tests/*.test.js
node scripts/smoke.mjs   # headless-Chrome smoke test of the new features
```

**179 tests, 179 pass, 0 fail** — markdown (escaping, code blocks, lists,
links), store (CRUD, search, persistence round-trip, corrupt storage,
default model is Gemini 3.8 Flash),
Gemini client (SSE parsing incl. split chunks and functionCall parts,
error mapping for wrong key / missing model / rate limit, abort, no-key
refusal), agent loop (tool call → result → answer, plan events, tool
failure carried back, turn limit, no-key refusal, history rebuild with
functionCall/functionResponse parts), tools (registry, arg validation,
URL builders, Gmail compose URL, calculator incl. divide-by-zero, HTML
stripping, Wikipedia → DuckDuckGo fallback, blocked fetch, weather
geocode + forecast, tasks/notes through the real stores, mail draft
never claiming to be sent, file cap), work stores (task dedupe,
complete/remove, note search, persistence), copy guard (no emoji, no
banned marketing words, no retired product-selling phrases, no Grok/xAI/study framing, Atlas named, mail
honesty line present), layout guards (viewport, no 100vw, two-rail
grid + trace drawer, code-block width cap, mobile breakpoint, all wired ids
incl. Home, palette, slash menu, plans, reminders, export/import),
reminders (plain-word parsing incl. "in 20 minutes" and "tomorrow at
9am", past time rolls to tomorrow, store round-trip), plans (step
labels for every tool, progress, store round-trip), search (fuzzy
scoring, grouped results with counts, plain-text excerpts), slash
commands (parse, prefix matching, builders), palette (actions, fuzzy
groups, selection wrap-around), voice (supported/unsupported, interim
and final results), backup (build excludes the API key, validate
rejects bad files, round-trip restores everything).

One real bug was found and fixed during verification: notes created in
the same millisecond sorted in insertion order instead of newest-first —
the sort now breaks ties by insertion order.

## Screenshots

All rendered in headless Chrome over `file://`, zero horizontal overflow
at 1280px and 390px (measured in the shot script, `overflowX: false`):

- `screenshots/desktop-home.png` — Home overview, dark
- `screenshots/desktop-chat.png` — agent turn with plan card and weather tool trace, dark
- `screenshots/desktop-light-chat.png` — same turn, light
- `screenshots/mobile-home.png` — Home, 390px
- `screenshots/mobile-chat.png` — agent turn, 390px
- `screenshots/mobile-light-chat.png` — agent turn, light, 390px
- `screenshots/command-palette-open.png` — palette open, query "rust", grouped results
- `screenshots/trace-drawer-open.png` — trace drawer open on the same turn

The chat screenshots use a sample conversation seeded by the shot script
only (titled "Sample chat"); the app itself contains no sample data. The
left rail in the shots is seeded with tasks, notes, plans and reminders
for the same reason.

## Contrast table (WCAG AA, normal text needs 4.5:1)

| Pair | Dark | Light | Pass |
| --- | --- | --- | --- |
| Text on background | #e8edf2 / #0a0e14 ≈ 16.4:1 | #0b1220 / #ffffff ≈ 18.7:1 | Yes |
| Muted on background | #9aa7b8 / #0a0e14 ≈ 7.9:1 | #475569 / #ffffff ≈ 7.6:1 | Yes |
| Faint on background | #7d8aa0 / #0a0e14 ≈ 5.5:1 | #64748b / #ffffff ≈ 4.8:1 | Yes |
| Amber accent text on background | #f5a524 / #0a0e14 ≈ 9.5:1 | #b45309 / #ffffff ≈ 5.0:1 | Yes |
| Send button | #1a1206 on #f5a524 ≈ 9.1:1 | #ffffff on #b45309 ≈ 5.0:1 | Yes |

## Honest limits

- **No key is bundled.** Without your free Gemini key, the app cannot
  chat — by design. It never shows a canned "demo" answer as if it were
  real.
- **Model names were verified against Google AI Studio's docs**
  (`gemini-3.8-flash` is the current Flash model and the default;
  `gemini-2.5-flash`, `gemini-2.0-flash`, `gemini-2.5-pro` kept as
  fallbacks), but live availability depends on your key and quota. A
  404 surfaces as a plain "try another model" message. No live call
  was made from this machine (no key exists here).
- **The key lives in the browser.** It is sent to Google's API with each
  request (that is how client-side Gemini apps work). Do not paste a key
  you use for anything else; a free AI Studio key is the right one.
- **Atlas cannot send mail.** A mail draft opens in Gmail compose; the
  user reviews and sends it there. Sending directly needs OAuth, which a
  static page does not have.
- **Atlas cannot control other websites or the browser.** It can search
  the web and read pages that allow cross-origin reads. Sites that block
  the read are reported as blocked, with the URL, and never described
  from invented content.
- **Reminders only fire while Atlas is open in a tab.** A reminder is a
  local timer checked every 20 seconds; a static page cannot wake
  itself, so a closed tab means no notification. The sidebar and
  Settings say this plainly.
- **Backups never include the API key.** Restoring a backup keeps the
  key already saved in that browser.
- **Voice input needs a browser with the Web Speech API** (Chrome,
  Edge, Safari). Where it is missing, the mic button says so instead
  of pretending to listen.
- **Plans only tick when a tool really runs.** A plan step is created
  from a real tool call in the agent loop; a step that never runs stays
  pending, and a step interrupted by Stop is marked failed.
- **Chats, tasks and notes live in one browser only.** No sync, no
  account, no server. Clearing browser data erases them; "Erase all
  chats" in Settings does the same on purpose. A JSON backup (above)
  is the way to keep a copy.
- **Fonts come from Google Fonts** (Inter + JetBrains Mono). Offline they
  fall back to system fonts; everything still works.
- **Pushed to GitHub** (`sivasaiboggu/atlas-agent`, `main`). Pages is not
  enabled yet — Siva must enable it in Settings → Pages.

## Launch checklist

- [x] Tests 179/179 green (+ 11 headless-Chrome smoke checks green)
- [x] Desktop 1280px + mobile 390px, zero overflow, eyeballed
- [x] Dark + light, same quality
- [x] Copy guard clean (no emoji, no clichés, no Grok/study framing)
- [x] No dead buttons, no placeholder features
- [ ] Siva adds his free Gemini key in Settings and sends one real message
- [ ] Siva enables Pages on the `atlas-agent` repo
- [ ] Siva tries it on his phone (390px) for real

## Risks

- Google may rename or retire a model — the picker then shows the real
  404 and the fix is a one-line model-list change.
- Free-tier quota (429) is per key; heavy use needs a paid key or waits.
- Popup blockers can stop the Gmail compose tab from opening on a tool
  call — the trace always carries an "Open in Gmail" link as the
  fallback, so the draft is never lost.

## Top 10 v2 ideas

1. Gmail OAuth (read + send) behind a small server or Google's JS client.
2. Calendar tools: free/busy, create events.
3. Web search with more sources (news, jobs boards) when the user asks.
4. Export a chat as a file (.md download).
5. System prompt per chat ("Be terse", "Explain every step").
6. Token-cost estimate per chat from real usage data.
7. Search that jumps to the matching message inside the chat.
8. Pinned chats and pinned tasks.
9. A tiny local proxy option so the key never leaves Siva's own machine.
10. Reminder sound or badge when a reminder fires while the tab is open.
