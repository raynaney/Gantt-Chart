/* ------------------------------------------------------------------------- */
/* Obsidian host                                                              */
/* ------------------------------------------------------------------------- */
const obsidian = require('obsidian');

const VIEW_TYPE = 'local-gantt-view';
const EXTENSION = 'gantt';
const ICON = 'calendar-range';

const toJson = (d) => JSON.stringify(d, null, 2);

/** Full-tab editor for *.gantt files (JSON). */
class GanttView extends obsidian.TextFileView {
  constructor(leaf) {
    super(leaf);
    this.gantt = null;
    this.raw = '';
  }

  getViewType() { return VIEW_TYPE; }
  getIcon() { return ICON; }
  getDisplayText() { return this.file ? this.file.basename : 'Gantt chart'; }

  async onOpen() {
    this.contentEl.addClass('lg-view');
    // Pick up edits made elsewhere (e.g. through an embedded chart in a note).
    this.registerEvent(this.app.vault.on('modify', async (file) => {
      if (!this.file || file !== this.file) return;
      const text = await this.app.vault.read(file);
      if (text !== this.raw) this.setViewData(text, false);
    }));
  }

  getViewData() { return this.raw; }

  setViewData(data, clear) {
    if (this.gantt && !clear && data === this.raw) return;
    let parsed;
    if (!data.trim()) {
      parsed = LocalGantt.starterData();
      data = toJson(parsed);
      this.requestSave();
    } else {
      try {
        parsed = JSON.parse(data);
      } catch (e) {
        this.showError(`This file isn't valid Gantt JSON (${e.message}). Fix it in a text editor, or delete it and create a new chart.`);
        this.raw = data;
        return;
      }
    }
    this.raw = data;
    if (this.gantt) {
      this.gantt.setData(parsed);
      return;
    }
    this.contentEl.empty();
    this.gantt = LocalGantt.create(this.contentEl, {
      data: parsed,
      className: 'lg-obsidian',
      onChange: (d) => {
        this.raw = toJson(d);
        this.requestSave();
      },
    });
  }

  showError(message) {
    if (this.gantt) { this.gantt.destroy(); this.gantt = null; }
    this.contentEl.empty();
    this.contentEl.createDiv({ cls: 'lg-error-box', text: message });
  }

  clear() {
    if (this.gantt) { this.gantt.destroy(); this.gantt = null; }
    this.raw = '';
    this.contentEl.empty();
  }

  async onClose() {
    if (this.gantt) { this.gantt.destroy(); this.gantt = null; }
  }
}

/** Interactive chart embedded in a note via a ```gantt code block. */
class GanttEmbed extends obsidian.MarkdownRenderChild {
  constructor(el, plugin, file, height) {
    super(el);
    this.plugin = plugin;
    this.file = file;
    this.height = height;
    this.gantt = null;
    this.last = null;
    this.timer = null;
  }

  async onload() {
    const vault = this.plugin.app.vault;
    const text = await vault.read(this.file);
    let parsed;
    try {
      parsed = text.trim() ? JSON.parse(text) : LocalGantt.starterData();
    } catch (e) {
      this.containerEl.createDiv({ cls: 'lg-error-box', text: `Could not read ${this.file.path}: ${e.message}` });
      return;
    }
    this.last = text;
    const box = this.containerEl.createDiv({ cls: 'lg-embed' });
    box.style.height = this.height + 'px';
    this.gantt = LocalGantt.create(box, {
      data: parsed,
      className: 'lg-obsidian',
      onChange: (d) => this.queueSave(d),
      toolbarExtras: [{
        label: 'Open in tab',
        title: `Open ${this.file.path} in its own tab`,
        onClick: () => this.plugin.app.workspace.getLeaf('tab').openFile(this.file),
      }],
    });
    this.registerEvent(vault.on('modify', async (file) => {
      if (file !== this.file || !this.gantt) return;
      const t = await vault.read(file);
      if (t === this.last) return;
      this.last = t;
      try { this.gantt.setData(JSON.parse(t)); } catch (_) { /* ignore invalid intermediate states */ }
    }));
  }

  queueSave(d) {
    this.last = toJson(d);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    if (this.timer == null) return;
    this.timer = null;
    this.plugin.app.vault.modify(this.file, this.last);
  }

  onunload() {
    if (this.timer != null) { clearTimeout(this.timer); this.flush(); }
    if (this.gantt) { this.gantt.destroy(); this.gantt = null; }
  }
}

class LocalGanttPlugin extends obsidian.Plugin {
  async onload() {
    this.registerView(VIEW_TYPE, (leaf) => new GanttView(leaf));
    this.registerExtensions([EXTENSION], VIEW_TYPE);

    this.addRibbonIcon(ICON, 'New Gantt chart', () => this.createChart());
    this.addCommand({ id: 'create-gantt-chart', name: 'Create new Gantt chart', callback: () => this.createChart() });
    this.addCommand({ id: 'create-example-gantt-chart', name: 'Create example Gantt chart', callback: () => this.createChart(null, true) });

    this.addCommand({ id: 'import-csv', name: 'Import Gantt chart from CSV file…', callback: () => this.importCsvFromDisk() });

    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof obsidian.TFolder) {
        menu.addItem((item) => item.setTitle('New Gantt chart').setIcon(ICON).onClick(() => this.createChart(file)));
      } else if (file instanceof obsidian.TFile && file.extension.toLowerCase() === 'csv') {
        menu.addItem((item) => item.setTitle('Convert to Gantt chart').setIcon(ICON).onClick(async () => {
          await this.importCsvText(await this.app.vault.read(file), file.name, file.parent);
        }));
      }
    }));

    this.registerMarkdownCodeBlockProcessor('gantt', (source, el, ctx) => this.renderCodeBlock(source, el, ctx));
  }

  async createChart(folder, example) {
    await this.createChartFile(example ? 'Example Gantt chart' : 'Gantt chart',
      example ? LocalGantt.sampleData() : LocalGantt.starterData(), folder);
  }

  async createChartFile(baseName, data, folder) {
    const vault = this.app.vault;
    if (!folder) {
      const active = this.app.workspace.getActiveFile();
      folder = this.app.fileManager.getNewFileParent(active ? active.path : '');
    }
    const dir = !folder || folder.isRoot() ? '' : folder.path + '/';
    const base = baseName.replace(/[\\/:*?"<>|#^[\]]+/g, '-').trim() || 'Gantt chart';
    let path = obsidian.normalizePath(`${dir}${base}.${EXTENSION}`);
    for (let i = 1; vault.getAbstractFileByPath(path); i++) path = obsidian.normalizePath(`${dir}${base} ${i}.${EXTENSION}`);
    const file = await vault.create(path, toJson(data));
    await this.app.workspace.getLeaf('tab').openFile(file);
    new obsidian.Notice(`Created ${file.path}`);
    return file;
  }

  /** Turn CSV text (e.g. an onlinegantt.com export) into a new .gantt file. */
  async importCsvText(text, fileName, folder) {
    let data;
    try {
      data = LocalGantt.fromCsv(text, { title: fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ') });
    } catch (e) {
      new obsidian.Notice(`Could not import ${fileName}: ${e.message}`, 8000);
      return null;
    }
    return this.createChartFile(fileName.replace(/\.[^.]+$/, ''), data, folder);
  }

  /** Pick a CSV file from the computer and import it. */
  importCsvFromDisk() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (file) await this.importCsvText(await file.text(), file.name);
    };
    input.click();
  }

  /*
   * ```gantt
   * file: Projects/Launch.gantt
   * height: 450
   * ```
   * A bare path (or [[wikilink]]) on its own line also works.
   */
  renderCodeBlock(source, el, ctx) {
    const opts = { file: '', height: 420 };
    for (const line of source.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const m = /^(file|height)\s*:\s*(.+)$/i.exec(t);
      if (m) opts[m[1].toLowerCase()] = m[2].trim();
      else if (!opts.file) opts.file = t;
    }
    const link = opts.file.replace(/^!?\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim();
    if (!link) {
      el.createDiv({ cls: 'lg-error-box', text: 'gantt block: add the path of a .gantt file, e.g. “file: Projects/Plan.gantt”.' });
      return;
    }
    const withExt = /\.gantt$/i.test(link) ? link : `${link}.${EXTENSION}`;
    const file = this.app.metadataCache.getFirstLinkpathDest(withExt, ctx.sourcePath)
      || this.app.vault.getAbstractFileByPath(obsidian.normalizePath(withExt));
    if (!(file instanceof obsidian.TFile)) {
      el.createDiv({ cls: 'lg-error-box', text: `gantt block: couldn't find “${withExt}”.` });
      return;
    }
    const height = Math.max(200, parseInt(opts.height, 10) || 420);
    ctx.addChild(new GanttEmbed(el, this, file, height));
  }
}

module.exports = LocalGanttPlugin;
