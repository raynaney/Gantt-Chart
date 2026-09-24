/*
 * Local Gantt — core chart component.
 * Shared by the Obsidian plugin and the standalone HTML page (see build.js).
 * No dependencies; renders into any DOM container.
 */
var LocalGantt = (function () {
  'use strict';

  const DAY_MS = 86400000;
  const ROW_H = 34;
  const HEAD_H = 66;
  const ZOOMS = {
    day: { dw: 32, label: 'Day', units: ['month', 'day'], pad: [7, 28] },
    week: { dw: 14, label: 'Week', units: ['month', 'week'], pad: [14, 56] },
    month: { dw: 4, label: 'Month', units: ['year', 'month'], pad: [45, 150] },
    quarter: { dw: 1.5, label: 'Quarter', units: ['year', 'quarter'], pad: [90, 365] },
  };
  const COLS = { name: 240, start: 124, end: 124, days: 56, progress: 56 };
  const PALETTE = [
    '#4f7cff', '#22a06b', '#f5a623', '#e5484d', '#8e4ec6',
    '#12a4b8', '#e86ab3', '#f76b15', '#7a8b99', '#2f3b52',
  ];
  const DEADLINE_COLOR = '#e5484d';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  // ---------------------------------------------------------------------------
  // Dates are stored as 'YYYY-MM-DD' strings and handled as integer day numbers
  // (days since the Unix epoch, UTC) so there are no timezone/DST surprises.
  // ---------------------------------------------------------------------------
  const pad2 = (n) => String(n).padStart(2, '0');

  function toNum(s) {
    if (typeof s !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const n = Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS;
    return Number.isFinite(n) ? n : null;
  }
  function toStr(n) {
    const d = new Date(n * DAY_MS);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  function todayNum() {
    const d = new Date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS;
  }
  function parts(n) {
    const d = new Date(n * DAY_MS);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay() };
  }
  const monthStart = (y, m) => Date.UTC(y, m, 1) / DAY_MS;
  const fmtShort = (n) => { const p = parts(n); return `${MONTHS[p.m]} ${p.d}`; };
  const fmtLong = (n) => { const p = parts(n); return `${MONTHS[p.m]} ${p.d}, ${p.y}`; };
  const isWeekend = (n) => { const wd = parts(n).wd; return wd === 0 || wd === 6; };

  function unitStart(kind, n) {
    const p = parts(n);
    switch (kind) {
      case 'day': return n;
      case 'week': return n - ((p.wd + 6) % 7); // weeks start on Monday
      case 'month': return monthStart(p.y, p.m);
      case 'quarter': return monthStart(p.y, p.m - (p.m % 3));
      default: return monthStart(p.y, 0);
    }
  }
  function unitNext(kind, n) {
    const p = parts(n);
    switch (kind) {
      case 'day': return n + 1;
      case 'week': return n - ((p.wd + 6) % 7) + 7;
      case 'month': return monthStart(p.y, p.m + 1);
      case 'quarter': return monthStart(p.y, p.m - (p.m % 3) + 3);
      default: return monthStart(p.y + 1, 0);
    }
  }
  function unitLabel(kind, n, top) {
    const p = parts(n);
    switch (kind) {
      case 'day': return String(p.d);
      case 'week': return `${MONTHS[p.m]} ${p.d}`;
      case 'month': return top ? `${MONTHS_LONG[p.m]} ${p.y}` : MONTHS[p.m];
      case 'quarter': return `Q${Math.floor(p.m / 3) + 1}`;
      default: return String(p.y);
    }
  }

  // ---------------------------------------------------------------------------
  // Misc helpers
  // ---------------------------------------------------------------------------
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const uid = () => Math.random().toString(36).slice(2, 10);

  function normColor(c) {
    if (typeof c !== 'string') return null;
    let m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
    if (m) return '#' + m[1].toLowerCase();
    m = /^#?([0-9a-f]{3})$/i.exec(c.trim());
    if (m) return '#' + m[1].split('').map((x) => x + x).join('').toLowerCase();
    return null;
  }
  function textOn(hex) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#1f2328' : '#ffffff';
  }

  function h(doc, tag, props, ...kids) {
    const el = doc.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === 'object' ? kid : doc.createTextNode(String(kid)));
    }
    return el;
  }

  // ---------------------------------------------------------------------------
  // Data model
  //   { version, title, settings: {zoom, showColumns},
  //     items: [{id, type: project|task|milestone, name, start, end, color,
  //              progress, parent, deadline, deadlineColor, collapsed, notes}],
  //     markers: [{id, name, date, color}] }
  // Any item may belong to a project via `parent` (projects can nest). A project
  // with children spans them automatically; its own start/end are only used when empty.
  // ---------------------------------------------------------------------------
  function blankData() {
    return { version: 1, title: 'Untitled plan', settings: { zoom: 'week', showColumns: true }, items: [], markers: [] };
  }

  function starterData() {
    const t = todayNum(), S = (n) => toStr(t + n), p = uid();
    const d = blankData();
    d.title = 'New plan';
    d.items = [
      { id: p, type: 'project', name: 'Project 1', color: PALETTE[0], deadline: S(21) },
      { id: uid(), type: 'task', parent: p, name: 'First task', start: S(0), end: S(6), color: PALETTE[0] },
      { id: uid(), type: 'milestone', parent: p, name: 'Milestone', start: S(10), color: PALETTE[3] },
    ];
    return normalize(d);
  }

  function sampleData() {
    const t = todayNum(), S = (n) => toStr(t + n), p1 = uid(), p2 = uid();
    return normalize({
      version: 1,
      title: 'My Project Plan',
      settings: { zoom: 'week', showColumns: true },
      items: [
        { id: p1, type: 'project', name: 'Website launch', color: PALETTE[0], deadline: S(42) },
        { id: uid(), type: 'task', parent: p1, name: 'Research & planning', start: S(-8), end: S(3), progress: 80, color: PALETTE[0] },
        { id: uid(), type: 'task', parent: p1, name: 'Design mockups', start: S(2), end: S(14), progress: 30, color: PALETTE[4] },
        { id: uid(), type: 'milestone', parent: p1, name: 'Design sign-off', start: S(15), color: PALETTE[3] },
        { id: uid(), type: 'task', parent: p1, name: 'Development', start: S(14), end: S(34), color: PALETTE[1] },
        { id: uid(), type: 'task', parent: p1, name: 'QA & testing', start: S(30), end: S(39), color: PALETTE[2] },
        { id: p2, type: 'project', name: 'Marketing', color: PALETTE[6], deadline: S(48), deadlineColor: PALETTE[7] },
        { id: uid(), type: 'task', parent: p2, name: 'Campaign prep', start: S(20), end: S(36), progress: 10, color: PALETTE[6] },
        { id: uid(), type: 'task', parent: p2, name: 'Press outreach', start: S(34), end: S(44), color: PALETTE[5] },
        { id: uid(), type: 'milestone', parent: p2, name: 'Launch day', start: S(45), color: PALETTE[3] },
      ],
      markers: [{ id: uid(), name: 'Board review', date: S(25), color: PALETTE[4] }],
    });
  }

  function normalize(raw) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const out = blankData();
    if (typeof d.title === 'string') out.title = d.title;
    const s = d.settings && typeof d.settings === 'object' ? d.settings : {};
    if (ZOOMS[s.zoom]) out.settings.zoom = s.zoom;
    if (typeof s.showColumns === 'boolean') out.settings.showColumns = s.showColumns;

    const today = toStr(todayNum());
    const ids = new Set();
    const freshId = (id) => {
      let v = typeof id === 'string' && id && !ids.has(id) ? id : uid();
      while (ids.has(v)) v = uid();
      ids.add(v);
      return v;
    };
    for (const it of Array.isArray(d.items) ? d.items : []) {
      if (!it || typeof it !== 'object') continue;
      const type = ['project', 'task', 'milestone'].includes(it.type) ? it.type : 'task';
      const sN = toNum(it.start) ?? toNum(today);
      let eN = type === 'milestone' ? sN : (toNum(it.end) ?? sN);
      if (eN < sN) eN = sN;
      out.items.push({
        id: freshId(it.id),
        type,
        name: it.name == null ? '' : String(it.name),
        start: toStr(sN),
        end: toStr(eN),
        color: normColor(it.color) || PALETTE[0],
        progress: clamp(Math.round(Number(it.progress)) || 0, 0, 100),
        parent: typeof it.parent === 'string' ? it.parent : null,
        deadline: toNum(it.deadline) != null ? toStr(toNum(it.deadline)) : null,
        deadlineColor: normColor(it.deadlineColor) || DEADLINE_COLOR,
        collapsed: !!it.collapsed,
        notes: typeof it.notes === 'string' ? it.notes : '',
      });
    }
    // Parents must be projects, and the hierarchy must not loop.
    const projects = new Map(out.items.filter((i) => i.type === 'project').map((i) => [i.id, i]));
    for (const it of out.items) if (!projects.has(it.parent) || it.parent === it.id) it.parent = null;
    for (const it of out.items) {
      const seen = new Set([it.id]);
      for (let p = projects.get(it.parent); p; p = projects.get(p.parent)) {
        if (seen.has(p.id)) { it.parent = null; break; }
        seen.add(p.id);
      }
    }

    for (const m of Array.isArray(d.markers) ? d.markers : []) {
      if (!m || typeof m !== 'object' || toNum(m.date) == null) continue;
      out.markers.push({
        id: freshId(m.id),
        name: m.name == null ? '' : String(m.name),
        date: toStr(toNum(m.date)),
        color: normColor(m.color) || DEADLINE_COLOR,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // CSV import — onlinegantt.com exports (and similar MS Project-style CSVs):
  //   Outline Level,ID,Name,Start,Finish,Duration,% Complete,Predecessors,
  //   Resource Names,Color,Notes
  // A row followed by deeper rows becomes a project; "0 day" rows become
  // milestones; numeric colours are hues (0-360).
  // ---------------------------------------------------------------------------
  function parseCsv(text, delim) {
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c !== '"') field += c;
        else if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((f) => f.trim() !== ''));
  }

  function parseDateLoose(s) {
    s = String(s || '').trim();
    if (!s) return null;
    const ymd = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? Date.UTC(y, m - 1, d) / DAY_MS : null);
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
    if (m) return ymd(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
    if (m) return +m[1] > 12 ? ymd(+m[3], +m[2], +m[1]) : ymd(+m[3], +m[1], +m[2]); // M/D/Y unless clearly D/M/Y
    const t = Date.parse(s);
    if (Number.isNaN(t)) return null;
    const d = new Date(t);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS;
  }

  function hslToHex(hue, sat, light) {
    const s = sat / 100, l = light / 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + hue / 30) % 12;
      const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(v * 255).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }
  function csvColor(v) {
    const t = String(v || '').trim();
    if (!t) return null;
    if (/^\d+(\.\d+)?$/.test(t)) return hslToHex(Number(t) % 360, 62, 52); // hue in degrees
    return normColor(t);
  }

  function htmlToText(s) {
    return String(s || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const DEP_TYPES = { FS: 'finish-to-start', SS: 'start-to-start', FF: 'finish-to-finish', SF: 'start-to-finish' };

  function fromCsv(text, options) {
    options = options || {};
    text = String(text || '').replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const count = (ch) => first.split(ch).length - 1;
    const delim = count('\t') > count(',') && count('\t') > count(';') ? '\t' : count(';') > count(',') ? ';' : ',';
    const rows = parseCsv(text, delim);
    if (!rows.length) throw new Error('The CSV file is empty.');

    const head = rows[0].map((x) => x.trim().toLowerCase().replace(/\s+/g, ' '));
    const col = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
    const C = {
      level: col('outline level', 'level', 'wbs level'),
      id: col('id', 'task id', 'unique id'),
      name: col('name', 'task name', 'task', 'title'),
      start: col('start', 'start date', 'begin'),
      end: col('finish', 'end', 'finish date', 'end date', 'due', 'due date'),
      duration: col('duration'),
      progress: col('% complete', 'percent complete', 'progress', '% done', 'complete'),
      preds: col('predecessors', 'dependencies'),
      res: col('resource names', 'resources', 'assignee', 'assigned to'),
      hex: col('hex color', 'hex colour'),
      color: col('color', 'colour'),
      notes: col('notes', 'note', 'description'),
    };
    if (C.name < 0 || C.start < 0) {
      throw new Error('This CSV needs at least a “Name” and a “Start” column (found: ' + rows[0].join(', ') + ').');
    }
    const get = (r, i) => (i >= 0 && i < r.length ? r[i].trim() : '');

    const recs = [];
    for (const r of rows.slice(1)) {
      const name = get(r, C.name);
      let s = parseDateLoose(get(r, C.start));
      let e = parseDateLoose(get(r, C.end));
      if (!name && s == null && e == null) continue;
      if (s == null) s = e != null ? e : todayNum();
      if (e == null || e < s) e = s;
      const dur = get(r, C.duration);
      recs.push({
        level: Math.max(1, parseInt(get(r, C.level), 10) || 1),
        srcId: get(r, C.id),
        name, s, e,
        milestone: dur !== '' && parseFloat(dur) === 0,
        progress: parseFloat(get(r, C.progress)) || 0,
        preds: get(r, C.preds),
        res: get(r, C.res),
        color: normColor(get(r, C.hex)) || csvColor(get(r, C.color)),
        notes: htmlToText(get(r, C.notes)),
      });
    }
    if (!recs.length) throw new Error('No tasks were found in this CSV.');

    // Rebuild the hierarchy from outline levels.
    const items = [];
    const stack = [];
    const bySrcId = new Map();
    recs.forEach((r, i) => {
      while (stack.length && stack[stack.length - 1].level >= r.level) stack.pop();
      const parent = stack.length ? stack[stack.length - 1] : null;
      const type = i + 1 < recs.length && recs[i + 1].level > r.level ? 'project' : r.milestone ? 'milestone' : 'task';
      const color = r.color || (parent && parent.color) || PALETTE[0];
      const it = {
        id: uid(), type, name: r.name,
        start: toStr(r.s), end: toStr(type === 'milestone' ? r.s : r.e),
        color, progress: clamp(Math.round(r.progress), 0, 100),
        parent: parent ? parent.id : null, notes: r.notes,
      };
      items.push(it);
      r.item = it;
      if (r.srcId) bySrcId.set(r.srcId, it);
      stack.push({ level: r.level, id: it.id, color });
    });

    // Dependencies and resources aren't drawn, so keep them readable in the notes.
    for (const r of recs) {
      const extra = [];
      if (r.preds) {
        const deps = r.preds.split(/[,;]/).map((x) => x.trim()).filter(Boolean).map((tok) => {
          const m = /^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+(?:\.\d+)?)\s*([a-z]*))?$/i.exec(tok);
          if (!m) return tok;
          const target = bySrcId.get(m[1]);
          const label = target ? `“${target.name}”` : `#${m[1]}`;
          const lag = m[3] ? `, ${m[3]}${m[4]} ${m[5] || 'days'}` : '';
          return `${label} (${DEP_TYPES[(m[2] || 'FS').toUpperCase()]}${lag})`;
        });
        extra.push('Depends on: ' + deps.join('; '));
      }
      if (r.res) extra.push('Resources: ' + r.res);
      if (extra.length) r.item.notes = [r.item.notes, ...extra].filter(Boolean).join('\n');
    }

    let min = Infinity, max = -Infinity;
    for (const it of items) { min = Math.min(min, toNum(it.start)); max = Math.max(max, toNum(it.end)); }
    const span = max - min;
    const zoom = span <= 45 ? 'day' : span <= 270 ? 'week' : span <= 1600 ? 'month' : 'quarter';
    return normalize({ version: 1, title: options.title || 'Imported plan', settings: { zoom, showColumns: true }, items, markers: [] });
  }

  // ---------------------------------------------------------------------------
  // CSV export — the same columns onlinegantt.com uses, so files can go back
  // there. Duration counts working days (Mon–Fri) like onlinegantt; Color is a
  // hue (0–360) as onlinegantt expects, and "Hex Color" keeps the exact colour.
  // ---------------------------------------------------------------------------
  function workdays(s, e) {
    let n = 0;
    for (let d = s; d <= e; d++) { const wd = parts(d).wd; if (wd !== 0 && wd !== 6) n++; }
    return n;
  }
  function hexToHue(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (!d) return 0;
    let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue *= 60;
    return Math.round(hue < 0 ? hue + 360 : hue);
  }
  const escHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const csvQ = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';

  /** Depth-first rows of a (normalized) plan, with spans and progress. */
  function planRows(d, includeCollapsed) {
    const kids = new Map();
    for (const it of d.items) { const k = it.parent || null; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(it); }
    const spans = new Map();
    const span = (it) => {
      if (spans.has(it.id)) return spans.get(it.id);
      let out;
      const ch = kids.get(it.id) || [];
      if (it.type === 'project' && ch.length) {
        let s = Infinity, e = -Infinity, tot = 0, done = 0;
        for (const k of ch) {
          const ks = span(k);
          s = Math.min(s, ks.s); e = Math.max(e, ks.e); tot += ks.tot; done += ks.done;
        }
        out = { s, e, auto: true, tot, done, progress: tot ? Math.round((done / tot) * 100) : it.progress };
      } else {
        const s = toNum(it.start), e = it.type === 'milestone' ? s : toNum(it.end);
        const len = it.type === 'task' ? e - s + 1 : 0;
        out = { s, e, auto: false, tot: len, done: (len * it.progress) / 100, progress: it.progress };
      }
      spans.set(it.id, out);
      return out;
    };
    const rows = [];
    const walk = (parent, depth) => {
      for (const it of kids.get(parent) || []) {
        rows.push({ it, depth, span: span(it) });
        if (it.type === 'project' && (includeCollapsed || !it.collapsed)) walk(it.id, depth + 1);
      }
    };
    walk(null, 0);
    return rows;
  }

  function toCsv(raw) {
    const d = normalize(raw);
    const head = ['Outline Level', 'ID', 'Name', 'Start', 'Finish', 'Duration', '% Complete', 'Predecessors', 'Resource Names', 'Color', 'Notes', 'Hex Color'];
    const lines = [head.join(',')];
    planRows(d, true).forEach((r, i) => {
      const { it, span } = r;
      const dur = it.type === 'milestone' ? 0 : workdays(span.s, span.e);
      const notes = it.notes ? it.notes.split('\n').map((l) => `<p>${l ? escHtml(l) : '<br>'}</p>`).join('') : '<p><br></p>';
      lines.push([
        r.depth + 1, i + 1, csvQ(it.name), toStr(span.s), toStr(span.e), `${dur} day`,
        Math.round(span.progress), csvQ(''), csvQ(''), hexToHue(it.color), csvQ(notes), it.color,
      ].join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  /** Parse a file's text as a plan: .gantt/.json, or CSV (by name or content). */
  function parseFile(text, fileName) {
    const name = String(fileName || '');
    const title = name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    const trimmed = String(text || '').replace(/^﻿/, '').trim();
    if (/\.(csv|tsv|txt)$/i.test(name) || (trimmed && trimmed[0] !== '{')) return fromCsv(text, { title: title || undefined });
    return normalize(JSON.parse(trimmed));
  }

  // ---------------------------------------------------------------------------
  // The chart component
  // ---------------------------------------------------------------------------
  function create(container, opts) {
    opts = opts || {};
    const doc = container.ownerDocument;
    const win = doc.defaultView || window;
    const E = (tag, props, ...kids) => h(doc, tag, props, ...kids);

    let data = normalize(opts.data === undefined ? sampleData() : opts.data);
    let undoStack = [];
    let redoStack = [];
    let selectedId = null;
    let range = { start: todayNum(), days: 1 };
    let dw = ZOOMS[data.settings.zoom].dw;
    let lastLW = null;
    let lastH = 0;
    let pendingToday = true;
    let modalEl = null;
    let destroyed = false;
    const reg = new Map(); // id -> timeline elements (for live drag previews)

    const rootEl = E('div', { class: 'lg-root' + (opts.className ? ' ' + opts.className : ''), tabindex: '-1' });
    const toolbarEl = E('div', { class: 'lg-toolbar' });
    const scrollEl = E('div', { class: 'lg-scroll' });
    const tipEl = E('div', { class: 'lg-tip' });
    rootEl.append(toolbarEl, scrollEl, tipEl);
    container.appendChild(rootEl);

    // ---- model helpers ------------------------------------------------------
    const byId = (id) => data.items.find((i) => i.id === id) || null;
    const childrenOf = (id) => data.items.filter((i) => i.parent === id);
    const descendantsOf = (id) => childrenOf(id).flatMap((k) => [k, ...descendantsOf(k.id)]);
    const leftWidth = () =>
      COLS.name + (data.settings.showColumns ? COLS.start + COLS.end + COLS.days + COLS.progress : 0);
    const x = (n) => (n - range.start) * dw;

    function spanOf(it) {
      if (it.type === 'project') {
        const kids = childrenOf(it.id);
        if (kids.length) {
          let s = Infinity, e = -Infinity;
          for (const k of kids) { const ks = spanOf(k); s = Math.min(s, ks.s); e = Math.max(e, ks.e); }
          return { s, e, auto: true };
        }
      }
      const s = toNum(it.start);
      return { s, e: it.type === 'milestone' ? s : toNum(it.end), auto: false };
    }
    function progressOf(it) {
      if (it.type !== 'project') return it.progress;
      const kids = descendantsOf(it.id).filter((k) => k.type === 'task');
      if (!kids.length) return it.progress;
      let total = 0, done = 0;
      for (const k of kids) { const sp = spanOf(k); const len = sp.e - sp.s + 1; total += len; done += (len * k.progress) / 100; }
      return total ? Math.round((done / total) * 100) : 0;
    }
    function visibleRows(all) {
      const out = [];
      const walk = (parent, depth) => {
        for (const it of data.items) {
          if (it.parent !== parent) continue;
          out.push({ it, depth });
          if (it.type === 'project' && (all || !it.collapsed)) walk(it.id, depth + 1);
        }
      };
      walk(null, 0);
      return out;
    }

    // ---- change handling ------------------------------------------------------
    const visibleRowsAll = () => visibleRows(true);
    const getData = () => JSON.parse(JSON.stringify(data));
    function emit() { if (opts.onChange) opts.onChange(getData()); }
    function mutate(fn) {
      const before = JSON.stringify(data);
      fn();
      if (JSON.stringify(data) === before) return render();
      undoStack.push(before);
      if (undoStack.length > 200) undoStack.shift();
      redoStack = [];
      render();
      emit();
    }
    function undo() {
      if (!undoStack.length) return;
      redoStack.push(JSON.stringify(data));
      data = JSON.parse(undoStack.pop());
      render();
      emit();
    }
    function redo() {
      if (!redoStack.length) return;
      undoStack.push(JSON.stringify(data));
      data = JSON.parse(redoStack.pop());
      render();
      emit();
    }
    function setSetting(k, v) { data.settings[k] = v; render(); emit(); }

    function select(id) {
      if (selectedId === id) return;
      selectedId = id;
      for (const row of scrollEl.querySelectorAll('.lg-row')) row.classList.toggle('is-selected', row.dataset.id === id);
    }

    function setStart(it, v) {
      const n = toNum(v);
      if (n == null) return render();
      mutate(() => {
        it.start = toStr(n);
        if (it.type === 'milestone' || toNum(it.end) < n) it.end = it.start;
      });
    }
    function setEnd(it, v) {
      const n = toNum(v);
      if (n == null) return render();
      mutate(() => {
        it.end = toStr(n);
        if (n < toNum(it.start)) it.start = it.end;
      });
    }
    function setDuration(it, days) {
      mutate(() => { it.end = toStr(toNum(it.start) + Math.max(1, days) - 1); });
    }
    function shiftItem(it, dd) {
      it.start = toStr(toNum(it.start) + dd);
      it.end = toStr(toNum(it.end) + dd);
    }
    // ---- restructuring: reorder, indent, outdent, drag rows --------------------
    const siblingsOf = (it) => data.items.filter((i) => i.parent === it.parent);

    /** Move `it` under `parentId` (null = top level), just before sibling `before`, or last. */
    function placeItem(it, parentId, before) {
      data.items.splice(data.items.indexOf(it), 1);
      it.parent = parentId;
      let idx;
      if (before) {
        idx = data.items.indexOf(before);
      } else {
        const sibs = data.items.filter((i) => i.parent === parentId);
        const anchor = sibs.length ? sibs[sibs.length - 1] : byId(parentId);
        idx = anchor ? data.items.indexOf(anchor) + 1 : data.items.length;
      }
      data.items.splice(idx, 0, it);
      for (let p = byId(parentId); p; p = byId(p.parent)) p.collapsed = false;
    }
    /** Tasks turn into projects when something is put inside them (like MS Project). */
    function makeContainer(p) {
      if (p && p.type === 'task') p.type = 'project';
    }

    function moveItem(it, dir) {
      const sibs = siblingsOf(it);
      const other = sibs[sibs.indexOf(it) + dir];
      if (!other) return notify(dir < 0 ? 'Already first in its group' : 'Already last in its group');
      mutate(() => {
        const a = data.items.indexOf(it), b = data.items.indexOf(other);
        data.items[a] = other;
        data.items[b] = it;
      });
    }
    function indentItem(it) {
      const sibs = siblingsOf(it);
      const prev = sibs[sibs.indexOf(it) - 1];
      if (!prev) return notify('Nothing above to indent under');
      if (prev.type === 'milestone') return notify('Can’t put items inside a milestone');
      mutate(() => { makeContainer(prev); placeItem(it, prev.id, null); });
    }
    function outdentItem(it) {
      const parent = byId(it.parent);
      if (!parent) return notify('Already at the top level');
      mutate(() => {
        const sibs = data.items.filter((i) => i.parent === parent.parent);
        placeItem(it, parent.parent, sibs[sibs.indexOf(parent) + 1] || null);
      });
    }

    let notifyTimer = null;
    function notify(text) {
      tipEl.textContent = text;
      tipEl.style.display = 'block';
      tipEl.style.left = Math.max(8, (rootEl.clientWidth - tipEl.offsetWidth) / 2) + 'px';
      tipEl.style.top = toolbarEl.offsetHeight + 8 + 'px';
      clearTimeout(notifyTimer);
      notifyTimer = setTimeout(hideTip, 1800);
    }

    /*
     * Drag a row by its handle. Vertical position picks the gap between rows;
     * horizontal movement picks the level (right = indent, left = outdent).
     */
    function dragRow(e, it) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      select(it.id);
      const handle = e.currentTarget;
      try { handle.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      rootEl.focus({ preventScroll: true });

      const banned = new Set([it.id, ...descendantsOf(it.id).map((k) => k.id)]);
      const all = visibleRows();
      const startDepth = (all.find((r) => r.it === it) || { depth: 0 }).depth;
      const rowEls = new Map([...scrollEl.querySelectorAll('.lg-row')].map((el) => [el.dataset.id, el]));
      for (const id of banned) if (rowEls.get(id)) rowEls.get(id).classList.add('is-dragging');
      const rows = all.filter((r) => !banned.has(r.it.id)).map((r) => Object.assign({ el: rowEls.get(r.it.id) }, r));
      const body = scrollEl.querySelector('.lg-body');
      const line = E('div', { class: 'lg-drop-line' });
      body.append(line);
      const x0 = e.clientX, y0 = e.clientY;
      let moved = false;
      let target = null;

      const compute = (ev) => {
        let g = 0;
        for (const r of rows) { const b = r.el.getBoundingClientRect(); if (b.top + b.height / 2 < ev.clientY) g++; }
        const A = rows[g - 1], B = rows[g];
        const maxD = A ? A.depth + (A.it.type !== 'milestone' ? 1 : 0) : 0;
        const minD = B ? B.depth : 0;
        const d = clamp(startDepth + Math.round((ev.clientX - x0) / 20), minD, Math.max(minD, maxD));
        let parentId, before;
        if (A && d === A.depth + 1) {
          parentId = A.it.id;
          before = B && B.depth === d ? B.it : null;
        } else {
          let node = A ? A.it : null, nd = A ? A.depth : 0;
          while (node && nd > d) { node = byId(node.parent); nd--; }
          parentId = node ? node.parent : null;
          if (B && B.depth === d) before = B.it;
          else if (node) { const sibs = data.items.filter((i) => i.parent === parentId && !banned.has(i.id)); before = sibs[sibs.indexOf(node) + 1] || null; }
          else before = null;
        }
        const bodyTop = body.getBoundingClientRect().top;
        const y = B ? B.el.getBoundingClientRect().top : A ? A.el.getBoundingClientRect().bottom : bodyTop;
        return { parentId, before, d, y: y - bodyTop };
      };

      const onMove = (ev) => {
        if (!moved && Math.abs(ev.clientY - y0) < 4 && Math.abs(ev.clientX - x0) < 4) return;
        moved = true;
        // Auto-scroll near the top/bottom edge.
        const sb = scrollEl.getBoundingClientRect();
        if (ev.clientY < sb.top + HEAD_H + 20) scrollEl.scrollTop -= 12;
        else if (ev.clientY > sb.bottom - 20) scrollEl.scrollTop += 12;
        target = compute(ev);
        const left = scrollEl.scrollLeft + 16 + target.d * 20;
        line.style.display = 'block';
        line.style.top = target.y - 1 + 'px';
        line.style.left = left + 'px';
        line.style.width = Math.max(40, scrollEl.clientWidth - (left - scrollEl.scrollLeft) - 8) + 'px';
        const p = byId(target.parentId);
        showTip(!p ? 'Top level'
          : p.type === 'task' ? `Make “${p.name || 'Untitled'}” a project and put this inside`
          : `Inside “${p.name || 'Untitled project'}”`, ev);
      };
      const onUp = (ev) => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        hideTip();
        line.remove();
        for (const el of rowEls.values()) el.classList.remove('is-dragging');
        if (!moved || !target || ev.type !== 'pointerup') return;
        const { parentId, before } = target;
        mutate(() => { makeContainer(byId(parentId)); placeItem(it, parentId, before); });
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    }
    function removeItem(it) {
      mutate(() => {
        const kill = new Set([it.id, ...descendantsOf(it.id).map((k) => k.id)]);
        data.items = data.items.filter((i) => !kill.has(i.id));
        if (kill.has(selectedId)) selectedId = null;
      });
    }
    function addItem(type) {
      const sel = byId(selectedId);
      const t = todayNum();
      let parent = null;
      let start = t;
      let index = data.items.length;
      if (type !== 'project') {
        const proj = sel ? (sel.type === 'project' ? sel : byId(sel.parent)) : null;
        if (proj) {
          parent = proj.id;
          const kids = childrenOf(proj.id);
          if (sel !== proj) {
            index = data.items.indexOf(sel) + 1;
            start = spanOf(sel).e + 1;
          } else if (kids.length) {
            index = data.items.indexOf(kids[kids.length - 1]) + 1;
            start = spanOf(proj).e + 1;
          } else {
            index = data.items.indexOf(proj) + 1;
            start = toNum(proj.start);
          }
        } else if (sel) {
          index = data.items.indexOf(sel) + 1;
          start = spanOf(sel).e + 1;
        }
      }
      const parentItem = parent && byId(parent);
      const names = { project: 'New project', task: 'New task', milestone: 'New milestone' };
      const len = { project: 14, task: 5, milestone: 1 };
      const it = {
        id: uid(), type, name: names[type],
        start: toStr(start), end: toStr(start + len[type] - 1),
        color: type === 'milestone' ? PALETTE[3]
          : parentItem ? parentItem.color
          : PALETTE[data.items.filter((i) => i.type === 'project').length % PALETTE.length],
        progress: 0, parent, deadline: null, deadlineColor: DEADLINE_COLOR, collapsed: false, notes: '',
      };
      selectedId = it.id;
      mutate(() => {
        data.items.splice(index, 0, it);
        for (let p = parentItem; p; p = byId(p.parent)) p.collapsed = false;
      });
      ensureVisible(start);
      const row = [...scrollEl.querySelectorAll('.lg-row')].find((r) => r.dataset.id === it.id);
      const input = row && row.querySelector('.lg-name');
      if (input) { input.focus(); input.select(); }
    }

    // ---- layout ---------------------------------------------------------------
    function computeRange(LW) {
      const zoom = ZOOMS[data.settings.zoom];
      const t = todayNum();
      let min = t, max = t;
      const see = (n) => { if (n == null) return; if (n < min) min = n; if (n > max) max = n; };
      for (const it of data.items) { see(toNum(it.start)); see(toNum(it.end)); see(toNum(it.deadline)); }
      for (const m of data.markers) see(toNum(m.date));
      min -= zoom.pad[0];
      max += zoom.pad[1];
      const need = Math.ceil(Math.max(0, scrollEl.clientWidth - LW) / dw) + 2;
      if (max - min + 1 < need) max = min + need - 1;
      const unit = zoom.units[1];
      min = unitStart(unit, min);
      max = unitNext(unit, max) - 1;
      range = { start: min, days: max - min + 1 };
    }
    function units(kind) {
      const out = [];
      const end = range.start + range.days;
      let n = unitStart(kind, range.start);
      while (n < end) {
        const nx = unitNext(kind, n);
        out.push({ n, s: Math.max(n, range.start), e: Math.min(nx, end) });
        n = nx;
      }
      return out;
    }
    function scrollToDate(n, frac) {
      const view = Math.max(0, scrollEl.clientWidth - leftWidth());
      scrollEl.scrollLeft = Math.max(0, x(n) - view * (frac == null ? 0.3 : frac));
    }
    function ensureVisible(n) {
      const view = Math.max(0, scrollEl.clientWidth - leftWidth());
      const px = x(n);
      if (px < scrollEl.scrollLeft || px > scrollEl.scrollLeft + view - 40) scrollToDate(n, 0.3);
    }

    // ---- rendering ------------------------------------------------------------
    function render() {
      if (destroyed) return;
      const LW = leftWidth();
      const newDw = ZOOMS[data.settings.zoom].dw;
      let anchor = null;
      if (!pendingToday && lastLW != null) {
        // Keep the same date under the left edge (or the centre, when zooming).
        const off = newDw === dw ? 0 : Math.max(0, scrollEl.clientWidth - lastLW) / 2;
        anchor = { date: range.start + (scrollEl.scrollLeft + off) / dw, off };
      }
      const top = scrollEl.scrollTop;
      dw = newDw;
      computeRange(LW);
      lastLW = LW;
      lastH = scrollEl.clientHeight;
      reg.clear();
      renderToolbar();

      const TW = range.days * dw;
      const rows = visibleRows();
      const canvas = E('div', { class: 'lg-canvas' }, renderHeader(LW, TW), renderBody(LW, TW, rows));
      scrollEl.replaceChildren(canvas);

      if (pendingToday) {
        if (scrollEl.clientWidth > 0) { scrollToDate(todayNum(), 0.25); pendingToday = false; }
      } else if (anchor) {
        scrollEl.scrollLeft = (anchor.date - range.start) * dw - anchor.off;
      }
      scrollEl.scrollTop = top;
    }

    function btn(label, title, onclick, extra) {
      return E('button', Object.assign({ type: 'button', class: 'lg-btn', title, onclick }, extra || {}), label);
    }

    function renderToolbar() {
      const zoom = data.settings.zoom;
      toolbarEl.replaceChildren(
        E('input', {
          class: 'lg-title', type: 'text', value: data.title, placeholder: 'Plan title', title: 'Rename this plan',
          onchange: (e) => mutate(() => { data.title = e.target.value; }),
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); },
        }),
        E('div', { class: 'lg-group' },
          btn('+ Project', 'Add a project (a group of tasks, with an optional deadline)', () => addItem('project')),
          btn('+ Task', 'Add a task (added to the selected project)', () => addItem('task')),
          btn('+ Milestone', 'Add a milestone (a single date)', () => addItem('milestone')),
          btn('+ Marker', 'Add a vertical marker line across the chart (e.g. a hard deadline)', () => openMarkerDialog(null))),
        E('div', { class: 'lg-group lg-seg' },
          Object.keys(ZOOMS).map((z) =>
            btn(ZOOMS[z].label, `Zoom: ${ZOOMS[z].label.toLowerCase()} view`, () => setSetting('zoom', z),
              { class: 'lg-btn' + (z === zoom ? ' is-active' : '') }))),
        E('div', { class: 'lg-group' },
          btn('Today', 'Scroll to today', () => scrollToDate(todayNum(), 0.3)),
          btn('Export…', 'Export the chart as an image (PNG) or as CSV', () => openExportDialog()),
          btn(data.settings.showColumns ? 'Hide columns' : 'Show columns', 'Toggle the date / duration / progress columns',
            () => setSetting('showColumns', !data.settings.showColumns)),
          btn('↶', 'Undo (Ctrl/Cmd+Z)', undo, { disabled: !undoStack.length }),
          btn('↷', 'Redo (Ctrl/Cmd+Shift+Z)', redo, { disabled: !redoStack.length })),
        E('div', { class: 'lg-spacer' }),
        E('div', { class: 'lg-group' }, (opts.toolbarExtras || []).map((b) => btn(b.label, b.title || '', b.onClick))),
      );
    }

    function renderHeader(LW, TW) {
      const hcell = (label, w, cls) => E('div', { class: 'lg-hcell ' + (cls || ''), style: { width: w + 'px' } }, label);
      const left = E('div', { class: 'lg-head-left', style: { width: LW + 'px' } },
        hcell('Name', COLS.name, 'lg-c-name'),
        data.settings.showColumns
          ? [hcell('Start', COLS.start), hcell('End', COLS.end), hcell('Days', COLS.days), hcell('%', COLS.progress)]
          : null);

      const right = E('div', { class: 'lg-head-right', style: { width: TW + 'px' } });
      const [topKind, botKind] = ZOOMS[data.settings.zoom].units;
      const t = todayNum();
      for (const u of units(topKind)) {
        right.append(E('div', { class: 'lg-unit lg-unit-top', style: { left: x(u.s) + 'px', width: (u.e - u.s) * dw + 'px' } },
          E('span', { class: 'lg-unit-text' }, unitLabel(topKind, u.n, true))));
      }
      for (const u of units(botKind)) {
        const cls = 'lg-unit lg-unit-bottom'
          + (botKind === 'day' && isWeekend(u.n) ? ' is-weekend' : '')
          + (t >= u.s && t < u.e ? ' is-today' : '');
        right.append(E('div', { class: cls, style: { left: x(u.s) + 'px', width: (u.e - u.s) * dw + 'px' } },
          E('span', { class: 'lg-unit-text' }, unitLabel(botKind, u.n, false))));
      }

      const strip = E('div', { class: 'lg-markstrip' });
      if (t >= range.start && t < range.start + range.days) {
        strip.append(E('div', { class: 'lg-mlabel lg-mlabel-today', style: { left: x(t) + dw / 2 + 'px' } }, 'Today'));
      }
      for (const m of data.markers) {
        const n = toNum(m.date);
        const lab = E('div', {
          class: 'lg-mlabel', title: `${m.name || 'Marker'} — ${fmtLong(n)} (drag to move, click to edit)`,
          style: { left: x(n) + dw / 2 + 'px', background: m.color, color: textOn(m.color) },
        }, m.name || 'Marker');
        lab.addEventListener('pointerdown', (e) => dragMarker(e, m));
        strip.append(lab);
        reg.set(m.id, [lab]);
      }
      right.append(strip);
      return E('div', { class: 'lg-head', style: { height: HEAD_H + 'px' } }, left, right);
    }

    function renderBody(LW, TW, rows) {
      const minH = Math.max(rows.length * ROW_H, scrollEl.clientHeight - HEAD_H - 1);
      const body = E('div', { class: 'lg-body', style: { minHeight: minH + 'px' } });
      body.append(E('div', { class: 'lg-left-fill', style: { width: LW + 'px' } },
        E('div', { class: 'lg-left-fill-inner', style: { width: LW + 'px', height: minH + 'px' } })));

      const grid = E('div', { class: 'lg-grid', style: { left: LW + 'px', width: TW + 'px' } });
      const zoom = data.settings.zoom;
      if (zoom === 'day' || zoom === 'week') {
        for (let n = range.start; n < range.start + range.days; n++) {
          if (parts(n).wd === 6) grid.append(E('div', { class: 'lg-gweekend', style: { left: x(n) + 'px', width: 2 * dw + 'px' } }));
        }
      }
      const [topKind, botKind] = ZOOMS[zoom].units;
      for (const u of units(botKind)) grid.append(E('div', { class: 'lg-gline', style: { left: x(u.s) + 'px' } }));
      for (const u of units(topKind)) grid.append(E('div', { class: 'lg-gline lg-gline-strong', style: { left: x(u.s) + 'px' } }));
      const t = todayNum();
      grid.append(E('div', { class: 'lg-today-line', style: { left: x(t) + dw / 2 - 1 + 'px' } }));
      for (const m of data.markers) {
        const line = E('div', { class: 'lg-mline', style: { left: x(toNum(m.date)) + dw / 2 - 1 + 'px', borderColor: m.color } });
        grid.append(line);
        reg.get(m.id).push(line);
      }
      body.append(grid);

      if (!rows.length) {
        body.append(E('div', { class: 'lg-empty', style: { left: LW + 24 + 'px' } },
          'No tasks yet — use “+ Project”, “+ Task” or “+ Milestone” above to start planning.'));
      }
      for (const r of rows) {
        const sp = spanOf(r.it);
        body.append(E('div', {
          class: `lg-row lg-type-${r.it.type}` + (r.it.id === selectedId ? ' is-selected' : ''),
          'data-id': r.it.id,
        }, renderLeft(r.it, r.depth, sp, LW), renderRight(r.it, sp, TW)));
      }
      return body;
    }

    function renderLeft(it, depth, sp, LW) {
      const cell = E('div', { class: 'lg-left', style: { width: LW + 'px' } });
      cell.addEventListener('pointerdown', () => select(it.id));

      const ro = (text) => E('span', { class: 'lg-ro' }, text);
      const col = (w, content) => E('div', { class: 'lg-c', style: { width: w + 'px' } }, content);
      const dateInput = (value, cb) => E('input', {
        class: 'lg-in lg-date', type: 'date', value,
        onchange: (e) => cb(e.target.value),
      });
      const numInput = (value, min, max, cb) => E('input', {
        class: 'lg-in lg-num', type: 'number', min: String(min), max: String(max), value: String(value),
        onchange: (e) => {
          const n = Number(e.target.value);
          if (e.target.value === '' || !Number.isFinite(n)) { e.target.value = String(value); return; }
          cb(clamp(Math.round(n), min, max));
        },
        onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      });

      const name = E('div', {
        class: 'lg-c lg-c-name' + (depth ? ' has-guides' : ''),
        style: { width: COLS.name + 'px', paddingLeft: 16 + depth * 20 + 'px', backgroundSize: depth * 20 + 'px 100%' },
      });
      name.append(E('span', {
        class: 'lg-grip', title: 'Drag to reorder — move right to indent, left to outdent',
        onpointerdown: (e) => dragRow(e, it),
      }, '⠿'));
      if (it.type === 'project') {
        name.append(E('button', {
          type: 'button', class: 'lg-caret' + (it.collapsed ? ' is-collapsed' : ''),
          title: it.collapsed ? 'Expand' : 'Collapse',
          onclick: () => mutate(() => { it.collapsed = !it.collapsed; }),
        }, '▾'));
      }
      const swatch = E('label', { class: 'lg-swatch lg-swatch-' + it.type, style: { background: it.color }, title: 'Change colour' },
        E('input', {
          type: 'color', value: it.color,
          oninput: (e) => { swatch.style.background = e.target.value; },
          onchange: (e) => mutate(() => { it.color = e.target.value; }),
        }));
      name.append(swatch, E('input', {
        class: 'lg-in lg-name', type: 'text', value: it.name,
        placeholder: it.type === 'project' ? 'Untitled project' : 'Untitled',
        onfocus: () => select(it.id),
        onchange: (e) => mutate(() => { it.name = e.target.value; }),
        onkeydown: (e) => {
          if (e.key === 'Enter') e.target.blur();
          if (e.key === 'Escape') { e.target.value = it.name; e.target.blur(); }
        },
      }), E('div', { class: 'lg-actions' },
        E('button', { type: 'button', class: 'lg-ibtn', title: 'Outdent (Shift+Tab)', onclick: () => outdentItem(it) }, '←'),
        E('button', { type: 'button', class: 'lg-ibtn', title: 'Indent into the row above (Tab)', onclick: () => indentItem(it) }, '→'),
        E('button', { type: 'button', class: 'lg-ibtn', title: 'Move up (Alt+↑)', onclick: () => moveItem(it, -1) }, '↑'),
        E('button', { type: 'button', class: 'lg-ibtn', title: 'Move down (Alt+↓)', onclick: () => moveItem(it, 1) }, '↓'),
        E('button', { type: 'button', class: 'lg-ibtn', title: 'Edit details…', onclick: () => openItemDialog(it) }, '✎')));
      cell.append(name);

      if (data.settings.showColumns) {
        const ms = it.type === 'milestone';
        cell.append(
          col(COLS.start, sp.auto ? ro(fmtLong(sp.s)) : dateInput(it.start, (v) => setStart(it, v))),
          col(COLS.end, ms ? ro('—') : sp.auto ? ro(fmtLong(sp.e)) : dateInput(it.end, (v) => setEnd(it, v))),
          col(COLS.days, ms ? ro('◆') : sp.auto ? ro(String(sp.e - sp.s + 1)) : numInput(sp.e - sp.s + 1, 1, 9999, (v) => setDuration(it, v))),
          col(COLS.progress, ms ? ro('') : sp.auto ? ro(progressOf(it) + '%')
            : numInput(it.progress, 0, 100, (v) => mutate(() => { it.progress = v; }))));
      }
      return cell;
    }

    function renderRight(it, sp, TW) {
      const cell = E('div', { class: 'lg-right', style: { width: TW + 'px' } });
      cell.addEventListener('pointerdown', (e) => { if (e.target === cell) select(it.id); });
      cell.addEventListener('dblclick', (e) => { if (e.target === cell) openItemDialog(it); });
      const x0 = x(sp.s);
      const w = (sp.e - sp.s + 1) * dw;
      const label = it.name || (it.type === 'project' ? 'Untitled project' : 'Untitled');
      const els = [];

      if (it.type === 'milestone') {
        const size = 16;
        const m = E('div', {
          class: 'lg-milestone', title: `${label} — ${fmtLong(sp.s)}`,
          style: { left: x0 + dw / 2 - size / 2 + 'px', background: it.color },
        });
        m.addEventListener('pointerdown', (e) => dragItem(e, it, 'move'));
        const out = E('div', { class: 'lg-out-label', style: { left: x0 + dw / 2 + size / 2 + 2 + 'px' } }, label);
        cell.append(m, out);
        els.push(m, out);
      } else {
        const project = it.type === 'project';
        const pr = progressOf(it);
        const bar = E('div', {
          class: 'lg-bar' + (project ? ' lg-bar-project' : ''),
          title: `${label}\n${fmtLong(sp.s)} – ${fmtLong(sp.e)} (${sp.e - sp.s + 1} days)` + (pr ? ` · ${pr}% done` : '')
            + (it.notes ? `\n\n${it.notes}` : ''),
          style: project
            ? { left: x0 + 'px', width: Math.max(w, 3) + 'px', color: it.color }
            : { left: x0 + 'px', width: Math.max(w, 3) + 'px', background: it.color, color: textOn(it.color) },
        });
        if (pr > 0) bar.append(E('div', { class: 'lg-bar-progress', style: { width: pr + '%' } }));
        const fits = !project && w > label.length * 7 + 18;
        if (fits) bar.append(E('span', { class: 'lg-bar-text' }, label));
        if (!sp.auto) {
          bar.append(
            E('div', { class: 'lg-handle lg-handle-l', title: 'Drag to change the start date', onpointerdown: (e) => dragItem(e, it, 'start') }),
            E('div', { class: 'lg-handle lg-handle-r', title: 'Drag to change the end date', onpointerdown: (e) => dragItem(e, it, 'end') }));
        }
        bar.addEventListener('pointerdown', (e) => dragItem(e, it, 'move'));
        cell.append(bar);
        els.push(bar);
        if (!fits) {
          const out = E('div', { class: 'lg-out-label' + (project ? ' is-project' : ''), style: { left: x0 + Math.max(w, 3) + 6 + 'px' } },
            label, project && pr ? E('span', { class: 'lg-out-pct' }, ` ${pr}%`) : null);
          cell.append(out);
          els.push(out);
        }
        if (project && it.deadline) {
          const dn = toNum(it.deadline);
          const late = sp.e > dn;
          if (late) bar.classList.add('is-late');
          const dl = E('div', {
            class: 'lg-deadline' + (late ? ' is-late' : ''),
            title: `Deadline: ${fmtLong(dn)}` + (late ? ` — the project runs ${sp.e - dn} day(s) past it` : '') + '\nDrag to move, click to edit',
            style: { left: x(dn + 1) - 1 + 'px', borderColor: it.deadlineColor },
          }, E('div', { class: 'lg-deadline-flag', style: { background: it.deadlineColor, color: textOn(it.deadlineColor) } },
            late ? '⚑ Late' : '⚑ ' + fmtShort(dn)));
          dl.addEventListener('pointerdown', (e) => dragDeadline(e, it, dl));
          cell.append(dl);
        }
      }
      reg.set(it.id, els);
      return cell;
    }

    // ---- dragging ---------------------------------------------------------------
    function showTip(text, ev) {
      const r = rootEl.getBoundingClientRect();
      tipEl.textContent = text;
      tipEl.style.display = 'block';
      tipEl.style.left = Math.min(ev.clientX - r.left + 14, r.width - tipEl.offsetWidth - 8) + 'px';
      tipEl.style.top = ev.clientY - r.top + 18 + 'px';
    }
    function hideTip() { tipEl.style.display = 'none'; }

    function drag(e, handlers) {
      const el = e.currentTarget;
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      rootEl.focus({ preventScroll: true });
      const x0 = e.clientX;
      let moved = false;
      let dd = 0;
      const onMove = (ev) => {
        const px = ev.clientX - x0;
        if (!moved && Math.abs(px) < 4) return;
        moved = true;
        dd = Math.round(px / dw);
        showTip(handlers.move(dd), ev);
      };
      const onUp = (ev) => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        hideTip();
        if (!moved) { if (ev.type === 'pointerup' && handlers.click) handlers.click(); return; }
        if (dd !== 0 && ev.type === 'pointerup') handlers.commit(dd);
        else render();
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    }

    function dragItem(e, it, mode) {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      select(it.id);
      const sp = spanOf(it);
      const own = reg.get(it.id) || [];
      const targets = [...own];
      if (mode === 'move' && it.type === 'project') for (const k of descendantsOf(it.id)) targets.push(...(reg.get(k.id) || []));
      for (const el of targets) { el._l = parseFloat(el.style.left) || 0; el._w = parseFloat(el.style.width) || 0; }
      const bar = own[0];
      const describe = (s, en) => it.type === 'milestone' ? fmtLong(s) : `${fmtShort(s)} – ${fmtShort(en)} · ${en - s + 1} days`;
      drag(e, {
        move(dd) {
          if (mode === 'move') {
            for (const el of targets) el.style.left = el._l + dd * dw + 'px';
            return describe(sp.s + dd, sp.e + dd);
          }
          if (mode === 'start') {
            const s = Math.min(sp.s + dd, sp.e), d = s - sp.s;
            bar.style.left = bar._l + d * dw + 'px';
            bar.style.width = bar._w - d * dw + 'px';
            return describe(s, sp.e);
          }
          const en = Math.max(sp.e + dd, sp.s), d = en - sp.e;
          bar.style.width = bar._w + d * dw + 'px';
          for (const el of own.slice(1)) el.style.left = el._l + d * dw + 'px';
          return describe(sp.s, en);
        },
        commit(dd) {
          mutate(() => {
            if (mode === 'move') {
              shiftItem(it, dd);
              if (it.type === 'project') for (const k of descendantsOf(it.id)) shiftItem(k, dd);
            } else if (mode === 'start') {
              it.start = toStr(Math.min(sp.s + dd, sp.e));
            } else {
              it.end = toStr(Math.max(sp.e + dd, sp.s));
            }
          });
        },
        click: () => openItemDialog(it),
      });
    }

    function dragDeadline(e, it, el) {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      select(it.id);
      const n0 = toNum(it.deadline);
      const l0 = parseFloat(el.style.left) || 0;
      drag(e, {
        move(dd) { el.style.left = l0 + dd * dw + 'px'; return 'Deadline: ' + fmtLong(n0 + dd); },
        commit(dd) { mutate(() => { it.deadline = toStr(n0 + dd); }); },
        click: () => openItemDialog(it),
      });
    }

    function dragMarker(e, m) {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const n0 = toNum(m.date);
      const els = reg.get(m.id) || [];
      for (const el of els) el._l = parseFloat(el.style.left) || 0;
      drag(e, {
        move(dd) { for (const el of els) el.style.left = el._l + dd * dw + 'px'; return `${m.name || 'Marker'}: ${fmtLong(n0 + dd)}`; },
        commit(dd) { mutate(() => { m.date = toStr(n0 + dd); }); },
        click: () => openMarkerDialog(m),
      });
    }

    // ---- dialogs ----------------------------------------------------------------
    function closeModal() {
      if (!modalEl) return;
      modalEl.remove();
      modalEl = null;
      rootEl.focus({ preventScroll: true });
    }
    function openModal(title, form) {
      closeModal();
      form.noValidate = true; // inputs are validated in code; native checks (e.g. `step`) would silently block Save
      const modal = E('div', { class: 'lg-modal', role: 'dialog', 'aria-label': title }, E('h3', null, title), form);
      modalEl = E('div', { class: 'lg-backdrop' }, modal);
      modalEl.addEventListener('pointerdown', (e) => { if (e.target === modalEl) closeModal(); });
      modalEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeModal(); } });
      rootEl.append(modalEl);
      const first = modal.querySelector('input[type=text], input, select, textarea');
      if (first) { first.focus(); if (first.select) first.select(); }
    }
    const field = (label, input) => {
      const span = E('span', { class: 'lg-field-label' }, label);
      // Only wrap real form controls in <label>; a label around buttons would "click" the first one.
      const tag = /^(INPUT|SELECT|TEXTAREA)$/.test(input.tagName) ? 'label' : 'div';
      const el = E(tag, { class: 'lg-field' }, span, input);
      el.labelEl = span;
      return el;
    };
    const inp = (type, value, attrs) => E('input', Object.assign({ class: 'lg-input', type, value: value == null ? '' : value }, attrs || {}));
    const opt = (value, label, current) => E('option', { value, selected: value === current }, label);

    function colorPicker(initial) {
      let cur = initial;
      const custom = E('input', { type: 'color', class: 'lg-color-custom', value: cur, title: 'Custom colour' });
      const wrap = E('div', { class: 'lg-palette' });
      const sync = () => {
        for (const b of wrap.querySelectorAll('.lg-pal')) b.classList.toggle('is-active', b.dataset.c === cur);
        custom.value = cur;
        custom.classList.toggle('is-active', !PALETTE.includes(cur));
      };
      for (const c of PALETTE) {
        wrap.append(E('button', { type: 'button', class: 'lg-pal', 'data-c': c, title: c, style: { background: c, color: c }, onclick: () => { cur = c; sync(); } }));
      }
      custom.addEventListener('input', () => { cur = custom.value; sync(); });
      wrap.append(custom);
      sync();
      return { el: wrap, get: () => cur };
    }
    function actionsRow(onDelete, deleteLabel) {
      let armed = false;
      const del = onDelete ? E('button', {
        type: 'button', class: 'lg-btn lg-btn-danger',
        onclick: () => {
          if (!armed) { armed = true; del.textContent = deleteLabel || 'Click again to delete'; return; }
          closeModal();
          onDelete();
        },
      }, 'Delete') : null;
      return E('div', { class: 'lg-modal-actions' }, del, E('div', { class: 'lg-spacer' }),
        E('button', { type: 'button', class: 'lg-btn', onclick: closeModal }, 'Cancel'),
        E('button', { type: 'submit', class: 'lg-btn lg-btn-primary' }, 'Save'));
    }

    function openItemDialog(it) {
      const sp = spanOf(it);
      const isProj = it.type === 'project';
      const auto = sp.auto;
      const kids = descendantsOf(it.id).length;

      const name = inp('text', it.name, { placeholder: 'Name' });
      // A project with items inside must stay a project; anything else can switch type.
      const typeSel = isProj && kids
        ? null
        : E('select', { class: 'lg-input' },
          opt('task', 'Task', it.type), opt('milestone', 'Milestone', it.type), opt('project', 'Project (group)', it.type));
      const banned = new Set([it.id, ...descendantsOf(it.id).map((k) => k.id)]);
      const parentSel = E('select', { class: 'lg-input' },
        opt('', '— none (top level) —', it.parent || ''),
        visibleRowsAll().filter((r) => r.it.type === 'project' && !banned.has(r.it.id))
          .map((r) => opt(r.it.id, '\u00a0\u00a0'.repeat(r.depth) + (r.it.name || 'Untitled project'), it.parent || '')));
      const start = inp('date', it.start);
      const end = inp('date', it.end);
      const progress = inp('number', String(it.progress), { min: '0', max: '100', step: '1' });
      const color = colorPicker(it.color);
      const deadline = isProj ? inp('date', it.deadline || '') : null;
      const dlColor = isProj ? colorPicker(it.deadlineColor) : null;
      const notes = E('textarea', { class: 'lg-input lg-notes', rows: '3', placeholder: 'Notes (optional)' });
      notes.value = it.notes;
      const error = E('div', { class: 'lg-error' });

      const startField = field('Start date', start);
      const endField = field('End date', end);
      const progField = field('Progress %', progress);
      const syncType = () => {
        const ms = typeSel && typeSel.value === 'milestone';
        startField.labelEl.textContent = ms ? 'Date' : 'Start date';
        endField.style.display = ms ? 'none' : '';
        progField.style.display = ms ? 'none' : '';
      };
      if (typeSel) typeSel.addEventListener('change', syncType);

      const body = [
        field('Name', name),
        E('div', { class: 'lg-field-row' }, typeSel ? field('Type', typeSel) : null, field('Inside project', parentSel)),
        auto
          ? E('div', { class: 'lg-note' }, `Dates follow the ${kids} item(s) in this project: ${fmtLong(sp.s)} – ${fmtLong(sp.e)} (${sp.e - sp.s + 1} days, ${progressOf(it)}% done).`)
          : E('div', { class: 'lg-field-row' }, startField, endField, progField),
        field('Colour', color.el),
        isProj ? E('div', { class: 'lg-field-row lg-deadline-row' },
          field('Deadline', E('div', { class: 'lg-inline' }, deadline,
            E('button', { type: 'button', class: 'lg-btn', title: 'Remove the deadline', onclick: () => { deadline.value = ''; } }, 'Clear'))),
          field('Deadline colour', dlColor.el)) : null,
        field('Notes', notes),
        error,
      ];
      syncType();

      const save = () => {
        const type = typeSel ? typeSel.value : it.type;
        let s = toNum(start.value);
        let en = toNum(end.value);
        if (!auto) {
          if (s == null) { error.textContent = 'Please pick a start date.'; return; }
          if (type === 'milestone') en = s;
          else if (en == null) { error.textContent = 'Please pick an end date.'; return; }
          else if (en < s) { error.textContent = 'The end date is before the start date.'; return; }
        }
        const d = deadline ? toNum(deadline.value) : null;
        closeModal();
        mutate(() => {
          it.name = name.value.trim();
          it.type = type;
          if (!auto) {
            it.start = toStr(s);
            it.end = toStr(en);
            if (type !== 'milestone') it.progress = clamp(Math.round(Number(progress.value)) || 0, 0, 100);
          }
          it.color = color.get();
          if ((parentSel.value || null) !== it.parent) placeItem(it, parentSel.value || null, null);
          if (isProj) { it.deadline = d == null ? null : toStr(d); it.deadlineColor = dlColor.get(); }
          it.notes = notes.value;
        });
      };
      const form = E('form', { class: 'lg-form', onsubmit: (e) => { e.preventDefault(); save(); } },
        body, actionsRow(() => removeItem(it), kids ? `Delete project and its ${kids} item(s)?` : null));
      openModal(isProj ? 'Edit project' : it.type === 'milestone' ? 'Edit milestone' : 'Edit task', form);
    }

    function openMarkerDialog(m) {
      const isNew = !m;
      const cur = m || { name: 'Deadline', date: toStr(todayNum() + 14), color: DEADLINE_COLOR };
      const name = inp('text', cur.name, { placeholder: 'e.g. Final deadline' });
      const date = inp('date', cur.date);
      const color = colorPicker(cur.color);
      const error = E('div', { class: 'lg-error' });
      const save = () => {
        const n = toNum(date.value);
        if (n == null) { error.textContent = 'Please pick a date.'; return; }
        closeModal();
        mutate(() => {
          const target = isNew ? { id: uid() } : m;
          target.name = name.value.trim();
          target.date = toStr(n);
          target.color = color.get();
          if (isNew) data.markers.push(target);
        });
        ensureVisible(n);
      };
      const form = E('form', { class: 'lg-form', onsubmit: (e) => { e.preventDefault(); save(); } },
        E('div', { class: 'lg-note' }, 'A marker draws a vertical line across the whole chart — handy for hard deadlines, reviews or holidays.'),
        E('div', { class: 'lg-field-row' }, field('Label', name), field('Date', date)),
        field('Colour', color.el),
        error,
        actionsRow(isNew ? null : () => mutate(() => { data.markers = data.markers.filter((x2) => x2.id !== m.id); })));
      openModal(isNew ? 'Add marker' : 'Edit marker', form);
    }

    // ---- export (PNG image / CSV) ----------------------------------------------
    const IMG_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    const IMG_THEMES = {
      light: { bg: '#ffffff', alt: '#f6f7f9', border: '#dde1e6', grid: '#eef0f3', text: '#1f2328', muted: '#6b7280', weekend: 'rgba(120,125,140,0.07)', today: '#e5484d' },
      dark: { bg: '#17181b', alt: '#1f2125', border: '#34373d', grid: '#25272b', text: '#e6e7e9', muted: '#9aa0a8', weekend: 'rgba(255,255,255,0.035)', today: '#e5484d' },
    };
    const MAX_CANVAS = 16000; // per side, safely under browser limits

    function saveBlob(filename, blob) {
      if (opts.saveFile) return opts.saveFile(filename, blob);
      const a = doc.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      doc.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return Promise.resolve();
    }
    const baseName = () => (data.title || 'gantt').replace(/[\\/:*?"<>|#^[\]]+/g, '-').trim() || 'gantt';

    function roundRect(ctx, x, y, w, h, r) {
      r = Math.max(0, Math.min(r, w / 2, h / 2));
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    function fitText(ctx, text, maxW) {
      if (ctx.measureText(text).width <= maxW) return text;
      let lo = 0, hi = text.length;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1; }
      return lo ? text.slice(0, lo) + '…' : '';
    }

    /** Everything needed to size and draw the image, derived from the export options. */
    function imageLayout(o) {
      const rows = planRows(data, o.expandAll);
      const measure = doc.createElement('canvas').getContext('2d');
      const rowH = o.rowH;
      const fs = Math.round(clamp(rowH * 0.4, 11, 16));
      const label = (it) => it.name || (it.type === 'project' ? 'Untitled project' : 'Untitled');

      // Date range
      let from, to;
      if (o.range === 'custom' && toNum(o.from) != null && toNum(o.to) != null) {
        from = Math.min(toNum(o.from), toNum(o.to)); to = Math.max(toNum(o.from), toNum(o.to));
      } else {
        from = Infinity; to = -Infinity;
        for (const r of rows) {
          from = Math.min(from, r.span.s); to = Math.max(to, r.span.e);
          if (o.showMarkers && r.it.deadline) { from = Math.min(from, toNum(r.it.deadline)); to = Math.max(to, toNum(r.it.deadline)); }
        }
        if (o.showMarkers) for (const m of data.markers) { from = Math.min(from, toNum(m.date)); to = Math.max(to, toNum(m.date)); }
        if (!Number.isFinite(from)) { from = todayNum(); to = from + 30; }
        const padDays = Math.max(2, Math.round((to - from) * 0.02));
        from -= padDays; to += padDays;
      }
      const days = to - from + 1;

      // Left columns
      let nameW = o.nameW;
      if (!nameW) {
        nameW = 160;
        for (const r of rows) {
          measure.font = `${r.it.type === 'project' ? 600 : 400} ${fs}px ${IMG_FONT}`;
          nameW = Math.max(nameW, 16 + r.depth * 16 + 22 + measure.measureText(label(r.it)).width + 12);
        }
        nameW = Math.ceil(Math.min(nameW, 640));
      }
      const dateW = o.showDates ? Math.ceil(fs * 7.2) : 0;
      const leftW = nameW + dateW * 2;
      const titleH = o.showTitle ? Math.round(fs * 3.4) : 0;
      const hasStrip = o.showMarkers && (data.markers.length > 0 || rows.some((r) => r.it.deadline));
      const headH = 48 + (hasStrip || o.showToday ? 20 : 0);

      // Timeline scale: user width, or the chart's current zoom. Leave room for
      // labels that stick out past the last bar so nothing gets cut off.
      measure.font = `${fs}px ${IMG_FONT}`;
      const labelW = rows.map((r) => measure.measureText(label(r.it) + (r.it.type === 'project' ? '  100%' : '')).width + 12);
      let pad = 16, dw2 = 1;
      for (let pass = 0; pass < 4; pass++) {
        dw2 = o.width ? Math.max(0.2, (o.width - leftW - pad) / days) : ZOOMS[data.settings.zoom].dw;
        let overflow = 0;
        rows.forEach((r, i) => {
          const endX = (Math.min(r.span.e, to) - from + 1) * dw2;
          const inside = r.it.type === 'task' && (r.span.e - r.span.s + 1) * dw2 > labelW[i] + 6;
          if (!inside && r.span.e >= from && r.span.s <= to) overflow = Math.max(overflow, endX + (r.it.type === 'milestone' ? 12 : 0) + labelW[i] - days * dw2);
        });
        const nextPad = Math.max(16, Math.ceil(overflow) + 8);
        if (nextPad === pad) break;
        pad = nextPad;
      }
      const TW = days * dw2;
      const W = Math.ceil(o.width || leftW + TW + pad);
      const H = titleH + headH + rows.length * rowH + 1;
      return { rows, from, to, days, dw: dw2, leftW, nameW, dateW, titleH, headH, rowH, fs, W, H, hasStrip, label };
    }

    function drawImage(o, L, canvas, scale) {
      canvas.width = Math.max(1, Math.round(L.W * scale));
      canvas.height = Math.max(1, Math.round(L.H * scale));
      const ctx = canvas.getContext('2d');
      const T = IMG_THEMES[o.theme] || IMG_THEMES.light;
      const { rows, from, to, days, dw: pd, leftW, nameW, dateW, titleH, headH, rowH, fs, W, H } = L;
      const X = (n) => leftW + (n - from) * pd;
      const font = (weight, size) => `${weight} ${size}px ${IMG_FONT}`;
      // Outline colours that would vanish into the background (e.g. white on the light theme).
      const lum = (hex) => (0.299 * parseInt(hex.slice(1, 3), 16) + 0.587 * parseInt(hex.slice(3, 5), 16) + 0.114 * parseInt(hex.slice(5, 7), 16)) / 255;
      const outline = (hex) => {
        const l = lum(hex);
        if (o.theme === 'dark' ? l > 0.12 : l < 0.85) return;
        ctx.strokeStyle = o.theme === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
      };
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.textBaseline = 'middle';
      ctx.fillStyle = T.bg;
      ctx.fillRect(0, 0, W, H);

      // Title
      if (titleH) {
        ctx.fillStyle = T.text;
        ctx.font = font(650, Math.round(fs * 1.45));
        ctx.fillText(fitText(ctx, data.title || 'Untitled plan', W * 0.6), 16, titleH / 2);
        ctx.fillStyle = T.muted;
        ctx.font = font(400, fs);
        ctx.textAlign = 'right';
        ctx.fillText(`${fmtLong(from)} – ${fmtLong(to)}`, W - 16, titleH / 2);
        ctx.textAlign = 'left';
      }

      // Time units: pick what fits the scale.
      const kinds = pd >= 18 ? ['month', 'day'] : pd * 7 >= 46 ? ['month', 'week'] : pd * 30 >= 26 ? ['year', 'month'] : pd * 91 >= 24 ? ['year', 'quarter'] : [null, 'year'];
      const unitsOf = (kind) => {
        const out = [];
        for (let n = unitStart(kind, from); n <= to; n = unitNext(kind, n)) out.push({ n, s: Math.max(n, from), e: Math.min(unitNext(kind, n), to + 1) });
        return out;
      };
      const top = titleH, bodyTop = titleH + headH;
      ctx.fillStyle = T.alt;
      ctx.fillRect(0, top, leftW, headH);
      ctx.save();
      ctx.beginPath(); ctx.rect(leftW, 0, W - leftW, H); ctx.clip();
      if (kinds[1] === 'day') {
        ctx.fillStyle = T.weekend;
        for (let n = from; n <= to; n++) if (isWeekend(n)) ctx.fillRect(X(n), top + 24, pd, H - top - 24);
      }
      ctx.fillStyle = T.grid;
      for (const u of unitsOf(kinds[1])) ctx.fillRect(Math.round(X(u.s)), top + 24, 1, H - top - 24);
      ctx.fillStyle = T.border;
      if (kinds[0]) for (const u of unitsOf(kinds[0])) ctx.fillRect(Math.round(X(u.s)), top, 1, H - top);
      const unitText = (kind, u, y, weight, color, isTop) => {
        const w = (u.e - u.s) * pd;
        ctx.font = font(weight, Math.round(fs * 0.85));
        const t = fitText(ctx, unitLabel(kind, u.n, isTop), w - 8);
        if (!t) return;
        ctx.fillStyle = color;
        ctx.fillText(t, X(u.s) + 5, y);
      };
      if (kinds[0]) for (const u of unitsOf(kinds[0])) unitText(kinds[0], u, top + 12, 650, T.text, true);
      for (const u of unitsOf(kinds[1])) unitText(kinds[1], u, top + 36, 400, T.muted, false);
      ctx.restore();

      // Column headers
      ctx.fillStyle = T.muted;
      ctx.font = font(650, Math.round(fs * 0.78));
      const hy = top + headH - 14;
      ctx.fillText('NAME', 12, hy);
      if (dateW) { ctx.fillText('START', nameW + 8, hy); ctx.fillText('END', nameW + dateW + 8, hy); }

      // Row separators
      ctx.fillStyle = T.grid;
      for (let i = 0; i <= rows.length; i++) ctx.fillRect(0, bodyTop + i * rowH, W, 1);
      ctx.fillStyle = T.border;
      ctx.fillRect(0, bodyTop, W, 1);
      ctx.fillRect(leftW, top, 1, H - top);

      // Left column: names (+dates)
      rows.forEach((r, i) => {
        const y = bodyTop + i * rowH + rowH / 2;
        const it = r.it;
        const x0 = 12 + r.depth * 16;
        ctx.fillStyle = it.color;
        if (it.type === 'milestone') {
          ctx.save(); ctx.translate(x0 + 6, y); ctx.rotate(Math.PI / 4); ctx.fillRect(-4.5, -4.5, 9, 9); ctx.restore();
        } else if (it.type === 'project') {
          ctx.beginPath(); ctx.arc(x0 + 6, y, 6, 0, Math.PI * 2); ctx.fill();
        } else {
          roundRect(ctx, x0, y - 6, 12, 12, 3); ctx.fill(); outline(it.color);
        }
        ctx.fillStyle = T.text;
        ctx.font = font(it.type === 'project' ? 650 : 400, fs);
        ctx.fillText(fitText(ctx, L.label(it), nameW - x0 - 24), x0 + 20, y);
        if (dateW) {
          ctx.fillStyle = T.muted;
          ctx.font = font(400, Math.round(fs * 0.88));
          ctx.fillText(fmtLong(r.span.s), nameW + 8, y);
          if (it.type !== 'milestone') ctx.fillText(fmtLong(r.span.e), nameW + dateW + 8, y);
        }
      });

      // Timeline: bars, milestones, deadlines
      ctx.save();
      ctx.beginPath(); ctx.rect(leftW + 1, bodyTop, W - leftW, H - bodyTop); ctx.clip();
      const outLabel = (text, x, y, weight, right) => {
        ctx.font = font(weight, fs);
        const w = ctx.measureText(text).width;
        ctx.fillStyle = T.text;
        if (x + w > W - 4 && right - w - 6 > leftW + 2) { ctx.textAlign = 'right'; ctx.fillText(text, right - 6, y); ctx.textAlign = 'left'; }
        else ctx.fillText(text, x, y);
      };
      rows.forEach((r, i) => {
        const it = r.it, sp = r.span;
        const yTop = bodyTop + i * rowH, y = yTop + rowH / 2;
        const x = X(sp.s), w = Math.max(2, (sp.e - sp.s + 1) * pd);
        if (sp.e < from || sp.s > to) return;
        if (it.type === 'milestone') {
          const sz = Math.min(rowH * 0.42, 14), cx = x + pd / 2;
          ctx.save(); ctx.translate(cx, y); ctx.rotate(Math.PI / 4);
          ctx.fillStyle = it.color; ctx.strokeStyle = T.bg; ctx.lineWidth = 2;
          roundRect(ctx, -sz / 2, -sz / 2, sz, sz, 2); ctx.fill(); ctx.stroke();
          ctx.restore();
          outLabel(L.label(it), cx + sz * 0.75 + 4, y, 400, cx - sz * 0.75);
        } else if (it.type === 'project') {
          const bh = Math.max(6, rowH * 0.28), by = y - bh / 2 - 2;
          ctx.fillStyle = it.color;
          ctx.fillRect(x, by, w, bh);
          ctx.beginPath(); ctx.moveTo(x, by + bh); ctx.lineTo(x + 6, by + bh); ctx.lineTo(x, by + bh + 6); ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.moveTo(x + w, by + bh); ctx.lineTo(x + w - 6, by + bh); ctx.lineTo(x + w, by + bh + 6); ctx.closePath(); ctx.fill();
          if (sp.progress > 0) { ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(x, by, (w * sp.progress) / 100, bh); }
          if (o.showMarkers && it.deadline) {
            const dn = toNum(it.deadline), dx = X(dn + 1), late = sp.e > dn;
            ctx.fillStyle = it.deadlineColor;
            ctx.fillRect(dx - 1, yTop + 2, 2, rowH - 4);
            ctx.font = font(650, Math.round(fs * 0.75));
            const t = late ? '⚑ Late' : '⚑ ' + fmtShort(dn);
            const tw = ctx.measureText(t).width + 8;
            roundRect(ctx, dx, yTop + 2, tw, Math.round(fs * 1.1), 3); ctx.fill();
            ctx.fillStyle = textOn(it.deadlineColor);
            ctx.fillText(t, dx + 4, yTop + 2 + Math.round(fs * 0.55));
          }
          outLabel(L.label(it) + (sp.progress ? `  ${sp.progress}%` : ''), x + w + 6, y, 650, x);
        } else {
          const bh = Math.max(10, rowH * 0.62), by = y - bh / 2;
          ctx.fillStyle = it.color;
          roundRect(ctx, x, by, w, bh, Math.min(6, bh / 3)); ctx.fill(); outline(it.color);
          if (sp.progress > 0) {
            ctx.save(); roundRect(ctx, x, by, w, bh, Math.min(6, bh / 3)); ctx.clip();
            ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(x, by, (w * sp.progress) / 100, bh);
            ctx.restore();
          }
          ctx.font = font(500, fs);
          const lab = L.label(it);
          if (ctx.measureText(lab).width + 16 <= w) {
            ctx.fillStyle = textOn(it.color);
            ctx.fillText(lab, Math.max(x, leftW) + 8, y);
          } else {
            outLabel(lab, x + w + 6, y, 400, x);
          }
        }
      });

      // Today line & markers on top
      const stripY = top + 48;
      const pill = (text, cx, bg, fg) => {
        ctx.font = font(650, Math.round(fs * 0.75));
        const tw = ctx.measureText(text).width + 12, ph = 15;
        ctx.fillStyle = bg;
        roundRect(ctx, cx - tw / 2, stripY + 2, tw, ph, ph / 2); ctx.fill();
        ctx.fillStyle = fg;
        ctx.textAlign = 'center'; ctx.fillText(text, cx, stripY + 2 + ph / 2); ctx.textAlign = 'left';
      };
      ctx.restore();
      ctx.save();
      ctx.beginPath(); ctx.rect(leftW + 1, top, W - leftW, H - top); ctx.clip();
      const t = todayNum();
      if (o.showToday && t >= from && t <= to) {
        ctx.fillStyle = T.today; ctx.globalAlpha = 0.8;
        ctx.fillRect(X(t) + pd / 2 - 1, stripY, 2, H - stripY);
        ctx.globalAlpha = 1;
        pill('Today', X(t) + pd / 2, T.today, '#ffffff');
      }
      if (o.showMarkers) {
        for (const m of data.markers) {
          const n = toNum(m.date);
          if (n < from || n > to) continue;
          const mx = X(n) + pd / 2;
          ctx.strokeStyle = m.color; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
          ctx.beginPath(); ctx.moveTo(mx, stripY + 18); ctx.lineTo(mx, H); ctx.stroke();
          ctx.setLineDash([]);
          pill(m.name || 'Marker', mx, m.color, textOn(m.color));
        }
      }
      ctx.restore();
    }

    function openExportDialog() {
      const o = {
        format: 'png', range: 'fit', from: '', to: '', width: 0, rowH: 30, nameW: 0,
        showDates: data.settings.showColumns, showTitle: true, showToday: true, showMarkers: true,
        expandAll: true, theme: 'light', scale: 2,
      };
      let L = imageLayout(o);
      o.from = toStr(L.from); o.to = toStr(L.to);

      let actual = false;
      const preview = E('canvas', { class: 'lg-export-canvas', title: 'Click to toggle between fit and actual size' });
      const previewHint = E('div', { class: 'lg-export-hint' });
      preview.addEventListener('click', () => { actual = !actual; refresh(); });
      const info = E('div', { class: 'lg-export-info' });
      const error = E('div', { class: 'lg-error' });
      const effScale = () => Math.max(0.5, Math.min(o.scale, MAX_CANVAS / L.W, MAX_CANVAS / L.H));
      const refresh = () => {
        L = imageLayout(o);
        const sc = effScale();
        const pw = Math.round(L.W * sc), ph = Math.round(L.H * sc);
        info.textContent = `${L.W} × ${L.H} px` + (sc !== 1 ? ` at ${+sc.toFixed(2)}× → ${pw} × ${ph} px` : '')
          + (sc < o.scale ? ' (resolution reduced to stay within the browser’s image size limit)' : '')
          + ` · ${L.rows.length} rows · ${fmtLong(L.from)} – ${fmtLong(L.to)}`;
        // "Fit" draws a small preview; "actual size" draws 1:1 (scrollable).
        if (actual) {
          const sc1 = Math.min(1, MAX_CANVAS / L.W, MAX_CANVAS / L.H);
          drawImage(o, L, preview, sc1);
          preview.style.width = L.W + 'px';
        } else {
          drawImage(o, L, preview, Math.min(1.5, 2400 / L.W, 2400 / L.H));
          preview.style.width = '';
        }
        previewHint.textContent = actual ? 'Actual size — click to fit' : 'Preview — click to see actual size';
      };
      const bind = (el, key, conv) => {
        el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => { o[key] = conv ? conv(el) : el.value; refresh(); });
        return el;
      };
      const num = (el) => Math.max(0, Math.round(Number(el.value) || 0));
      const check = (key, label) => E('label', { class: 'lg-check' }, bind(E('input', { type: 'checkbox', checked: o[key] }), key, (el) => el.checked), ' ', label);
      const seg = (key, choices) => {
        const wrap = E('div', { class: 'lg-seg lg-group' });
        const paint = () => { for (const b of wrap.children) b.classList.toggle('is-active', String(o[key]) === b.dataset.v); };
        for (const [v, label] of choices) {
          wrap.append(E('button', { type: 'button', class: 'lg-btn', 'data-v': String(v), onclick: () => { o[key] = v; paint(); onSeg(key); } }, label));
        }
        paint();
        return wrap;
      };

      const widthIn = inp('number', '', { min: '300', max: String(MAX_CANVAS), step: '10', placeholder: 'Auto' });
      const setWidth = (w) => { o.width = w; widthIn.value = w ? String(w) : ''; refresh(); };
      bind(widthIn, 'width', (el) => { const v = num(el); return v && v < 300 ? 300 : Math.min(v, MAX_CANVAS); });
      const fromIn = bind(inp('date', o.from), 'from');
      const toIn = bind(inp('date', o.to), 'to');
      const customRow = E('div', { class: 'lg-field-row' }, field('From', fromIn), field('To', toIn));
      const rowIn = bind(inp('range', String(o.rowH), { min: '18', max: '56', step: '2' }), 'rowH', num);
      const nameIn = bind(inp('number', '', { min: '80', max: '900', step: '10', placeholder: 'Auto (fits longest name)' }), 'nameW', num);

      const pngPane = E('div', { class: 'lg-export-pane' },
        E('div', { class: 'lg-field-row' },
          field('Dates shown', seg('range', [['fit', 'Fit all items'], ['custom', 'Custom range']])),
          field('Theme', seg('theme', [['light', 'Light'], ['dark', 'Dark']])),
          field('Resolution', seg('scale', [[1, '1×'], [2, '2×'], [3, '3×']]))),
        customRow,
        E('div', { class: 'lg-field-row' },
          field('Image width (px)', E('div', { class: 'lg-inline' }, widthIn,
            E('button', { type: 'button', class: 'lg-btn', title: 'Same horizontal scale as the chart view', onclick: () => setWidth(0) }, 'Auto'),
            E('button', { type: 'button', class: 'lg-btn', title: 'Fit on a typical slide/screen', onclick: () => setWidth(1920) }, '1920'),
            E('button', { type: 'button', class: 'lg-btn', onclick: () => setWidth(3000) }, '3000'))),
          field('Row height', rowIn),
          field('Name column (px)', nameIn)),
        E('div', { class: 'lg-checks' },
          check('showDates', 'Start/end columns'), check('showTitle', 'Title'), check('showToday', 'Today line'),
          check('showMarkers', 'Markers & deadlines'), check('expandAll', 'Include collapsed rows')),
        E('div', { class: 'lg-export-preview' }, preview), previewHint,
        info);
      const csvPane = E('div', { class: 'lg-export-pane' },
        E('div', { class: 'lg-note' },
          'Exports every row in the onlinegantt.com CSV format (Outline Level, ID, Name, Start, Finish, Duration, % Complete, …), ',
          'so it can be imported back into onlinegantt, opened in Excel/Sheets, or re-imported here. ',
          'Duration is in working days. Colours are written as a hue (for onlinegantt) plus an exact “Hex Color” column. ',
          'Markers and project deadlines have no CSV equivalent and are left out.'));

      const primary = E('button', { type: 'submit', class: 'lg-btn lg-btn-primary' }, 'Save PNG');
      const copyBtn = E('button', {
        type: 'button', class: 'lg-btn', title: 'Copy the image to the clipboard',
        onclick: () => withImage((blob) => {
          const Item = win.ClipboardItem;
          if (!Item || !win.navigator.clipboard) throw new Error('Copying images isn’t supported here — use Save PNG.');
          return win.navigator.clipboard.write([new Item({ 'image/png': blob })]).then(() => notify('Image copied to clipboard'));
        }),
      }, 'Copy image');
      const syncFormat = () => {
        pngPane.style.display = o.format === 'png' ? '' : 'none';
        csvPane.style.display = o.format === 'csv' ? '' : 'none';
        copyBtn.style.display = o.format === 'png' ? '' : 'none';
        primary.textContent = o.format === 'png' ? 'Save PNG' : 'Save CSV';
      };
      const onSeg = (key) => {
        if (key === 'format') syncFormat();
        else if (key === 'range') { customRow.style.display = o.range === 'custom' ? '' : 'none'; refresh(); }
        else refresh();
      };

      function withImage(fn) {
        error.textContent = '';
        const c = doc.createElement('canvas');
        drawImage(o, L, c, effScale());
        return new Promise((res) => c.toBlob(res, 'image/png'))
          .then((blob) => { if (!blob) throw new Error('The image is too large — lower the width or resolution.'); return fn(blob); })
          .catch((e) => { error.textContent = e.message || String(e); });
      }
      const save = () => {
        if (o.format === 'csv') {
          saveBlob(baseName() + '.csv', new win.Blob([toCsv(data)], { type: 'text/csv' }));
          closeModal();
          return;
        }
        withImage((blob) => Promise.resolve(saveBlob(baseName() + '.png', blob)).then(() => closeModal()));
      };

      const form = E('form', { class: 'lg-form', onsubmit: (e) => { e.preventDefault(); save(); } },
        field('Format', seg('format', [['png', 'Image (PNG)'], ['csv', 'CSV (onlinegantt)']])),
        pngPane, csvPane, error,
        E('div', { class: 'lg-modal-actions' }, E('div', { class: 'lg-spacer' }),
          E('button', { type: 'button', class: 'lg-btn', onclick: closeModal }, 'Cancel'), copyBtn, primary));
      openModal('Export', form);
      modalEl.firstChild.classList.add('lg-modal-wide');
      customRow.style.display = 'none';
      syncFormat();
      refresh();
    }

    // ---- keyboard & resize --------------------------------------------------------
    rootEl.addEventListener('keydown', (e) => {
      if (modalEl) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const sel = byId(selectedId);
      if (sel && e.key === 'Tab') { e.preventDefault(); if (e.shiftKey) outdentItem(sel); else indentItem(sel); return; }
      if (sel && e.altKey && e.key === 'ArrowUp') { e.preventDefault(); moveItem(sel, -1); return; }
      if (sel && e.altKey && e.key === 'ArrowDown') { e.preventDefault(); moveItem(sel, 1); return; }
      if (sel && e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); outdentItem(sel); return; }
      if (sel && e.altKey && e.key === 'ArrowRight') { e.preventDefault(); indentItem(sel); return; }
      if (mod && key === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && key === 'y') { e.preventDefault(); e.stopPropagation(); redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && byId(selectedId)) { e.preventDefault(); removeItem(byId(selectedId)); }
      else if (e.key === 'Enter' && byId(selectedId)) { e.preventDefault(); openItemDialog(byId(selectedId)); }
    });

    const ro = new win.ResizeObserver(() => {
      if (destroyed) return;
      const w = scrollEl.clientWidth;
      if (pendingToday && w > 0) return render();
      if (w - leftWidth() > range.days * dw || scrollEl.clientHeight > lastH) render();
    });
    ro.observe(scrollEl);

    render();

    return {
      el: rootEl,
      getData,
      setData(d) { data = normalize(d); undoStack = []; redoStack = []; render(); },
      /** Replace the whole plan as an undoable change (e.g. after an import). */
      replaceData(d) { const next = normalize(d); selectedId = null; pendingToday = true; mutate(() => { data = next; }); },
      render,
      undo,
      redo,
      destroy() { destroyed = true; ro.disconnect(); rootEl.remove(); },
    };
  }

  return { create, normalize, fromCsv, toCsv, parseFile, sampleData, starterData, blankData, PALETTE };
})();

if (typeof module !== 'undefined' && module.exports) module.exports.LocalGantt = LocalGantt;
