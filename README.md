# Local Gantt

A local, offline Gantt chart app inspired by onlinegantt.com. It comes in two forms that share the same code and file format:

| | What it is | Where your data lives |
|---|---|---|
| **Obsidian plugin** (`obsidian-plugin/`) | Opens `.gantt` files in their own tab. You can also embed a chart in any note. | `.gantt` files (JSON) in your vault |
| **Standalone page** (`standalone/local-gantt.html`) | One HTML file. Double-click it to open it in any browser; no install or internet needed. | The browser's local storage, plus Save/Open for `.gantt` files |

## Features

- **Gantt timeline** with Day / Week / Month / Quarter zoom, weekend shading and a "Today" line.
- **Projects**: group tasks under a project. The project bar spans its tasks automatically and shows overall % done. Projects can be collapsed.
- **Project deadlines**: each project can have a deadline flag with its own colour. Drag the flag to move it. If the work runs past the deadline, the project is outlined in red and the flag says "Late".
- **Tasks**: bars you can drag to move, or drag by either edge to change the start or end date. Tasks have a progress %.
- **Milestones**: diamonds that mark a single date. Drag them to move them.
- **Markers**: vertical lines across the whole chart for hard deadlines, reviews, holidays and so on. Drag the label to move one, click it to edit.
- **Custom colours** for everything: pick from the palette or any colour you like, from the swatch in the table or in the edit dialog.
- **Set dates yourself**: edit Start, End, Days and % right in the table, or click a bar (or ✎) for the full edit dialog with notes.
- **Nested projects**: projects can sit inside other projects, as many levels deep as you like. Use "Inside project" in the edit dialog to move any row.
- **CSV import**: bring in a CSV export from onlinegantt.com (see below).
- Reorder rows with ↑ / ↓. Undo and redo with Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z. Press Delete to remove the selected row and Enter to edit it.
- Light and dark themes. Inside Obsidian it follows your Obsidian theme.

## Install in Obsidian

1. Copy the `obsidian-plugin` folder into your vault as
   `<your vault>/.obsidian/plugins/local-gantt/`
   (it must contain `manifest.json`, `main.js` and `styles.css`).
2. In Obsidian, open **Settings → Community plugins**, turn off Restricted mode if it is on, press the reload button, and enable **Local Gantt**.
3. Create a chart in any of these ways:
   - click the calendar icon in the left ribbon,
   - run **"Local Gantt: Create new Gantt chart"** (or **"…example Gantt chart"**) from the command palette,
   - right-click a folder and choose **New Gantt chart**.

   The chart is saved as `Gantt chart.gantt`. Rename it like any other file.

### Embed a chart in a note

````markdown
```gantt
file: Projects/Launch.gantt
height: 450
```
````

The embedded chart is fully editable, and your changes are saved to the `.gantt` file. You can also write a `[[Launch]]`-style link on its own line instead of `file:`.

## Import from CSV (onlinegantt.com export)

The importer reads CSV exports with these columns:

```
Outline Level,ID,Name,Start,Finish,Duration,% Complete,Predecessors,Resource Names,Color,Notes
```

- **Obsidian**: run **"Local Gantt: Import Gantt chart from CSV file…"** and pick the file. The chart opens as a new `.gantt` file named after the CSV. If the CSV is already in your vault, you can instead right-click it and choose **Convert to Gantt chart** (Obsidian only lists `.csv` files when *Settings → Files & links → Detect all file extensions* is on).
- **Standalone**: click **Import CSV…** (or **Open…**), or drag the file onto the page. This replaces the current plan, and Ctrl/Cmd+Z brings the old one back.

How the columns are mapped:
- **Outline Level** sets the nesting. A row followed by deeper rows becomes a project.
- Rows with a duration of `0 day` become milestones.
- **Start** and **Finish** set the dates. Finish is included in the task. The **Days** column in the app counts calendar days, whereas onlinegantt's Duration counts working days, so the numbers will differ.
- **Color** values are hues (0–360) and are converted to colours. Rows with no colour take their parent project's colour.
- **% Complete** becomes the progress.
- **Notes** HTML is turned into plain text.
- **Predecessors** (for example `13FS+28 days`) and **Resource Names** are added to each task's notes as readable text. Dependency arrows aren't drawn.
- Only **Name** and **Start** are required, so simpler CSVs work too. Semicolon- or tab-separated files are also accepted.

## Use it without Obsidian

Open `standalone/local-gantt.html` in a browser. Your plan saves automatically in that browser.

- **Save…** downloads a `.gantt` file.
- **Open…** loads a `.gantt` or `.csv` file.
- **Print** prints the chart or saves it as a PDF.

The `.gantt` files work in both the standalone page and the Obsidian plugin.

## Development

The sources are in `src/`. After editing them, rebuild both targets with Node:

```sh
node build.js
```

The build has no dependencies. It writes `obsidian-plugin/main.js`, `obsidian-plugin/styles.css` and `standalone/local-gantt.html`.

- `src/gantt-core.js` – the chart component, shared by both targets
- `src/gantt.css` – shared styles (colour tokens)
- `src/obsidian-plugin.js`, `src/obsidian.css` – the Obsidian wrapper (file view, commands, code-block embed, theme bridge)
- `src/standalone-app.js`, `src/standalone.html` – the standalone wrapper

### File format

A `.gantt` file is plain JSON:

```json
{
  "version": 1,
  "title": "My plan",
  "settings": { "zoom": "week", "showColumns": true },
  "items": [
    { "id": "p1", "type": "project", "name": "Launch", "color": "#4f7cff",
      "deadline": "2026-11-30", "deadlineColor": "#e5484d" },
    { "id": "t1", "type": "task", "parent": "p1", "name": "Build", "start": "2026-10-01",
      "end": "2026-10-20", "progress": 40, "color": "#22a06b", "notes": "" },
    { "id": "m1", "type": "milestone", "parent": "p1", "name": "Go live", "start": "2026-11-25",
      "color": "#e5484d" }
  ],
  "markers": [{ "id": "k1", "name": "Hard deadline", "date": "2026-12-01", "color": "#e5484d" }]
}
```
