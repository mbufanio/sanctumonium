# Solution Briefing — web deck

A self-contained, dependency-free presentation that runs in any web browser.
No build step, no internet required, no PowerPoint. It can live on a website
**and** run from a laptop on a trade-show floor with no connection.

## Run it

Just open `index.html` in a web browser (double-click it). That's it.

- **Arrow keys** (or **Space**) — next / previous slide
- **F** — fullscreen (also the ⛶ button, bottom-right)
- Click the right/left half of the screen to move forward/back
- `index.html#slide-4` opens directly on slide 4

> For local video backgrounds some browsers restrict `file://` playback.
> If a background video doesn't play on a double-clicked file, run a tiny
> local server instead: `python3 -m http.server` then open
> `http://localhost:8000`. (Not needed if you have no videos.)

## Export a static copy (PDF)

Press **Ctrl/Cmd + P** → **Save as PDF**. Set margins to *None* and enable
*Background graphics*. You get one slide per page. See `TUTORIAL` for details
and the PowerPoint (.pptx) caveat.

## Files

| File | What it is |
|---|---|
| `index.html` | The slides — the text and structure of every slide |
| `styles.css` | The look — colors, fonts, sizes (brand config at the very top) |
| `deck.js` | The engine — arrow-key navigation (you won't need to edit this) |
| `assets/` | Logo, images, and videos |

To rebrand this deck to your company, follow `Solution-Briefing-Tutorial.pdf`.

## Host it on a website

Upload this whole folder to any static web host (company web server, S3,
Netlify, GitHub Pages, SharePoint). No server-side code is required.
