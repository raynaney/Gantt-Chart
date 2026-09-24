/* Standalone host: keeps the plan in localStorage and imports/exports .gantt files. */
(function () {
  'use strict';
  const KEY = 'local-gantt:data';

  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { stored = null; }

  function persist(d) {
    document.title = (d.title || 'Untitled plan') + ' — Local Gantt';
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (_) { /* storage unavailable */ }
  }

  function loadFile(file) {
    file.text().then((text) => {
      try {
        gantt.replaceData(LocalGantt.parseFile(text, file.name));
      } catch (e) {
        alert('Could not open “' + file.name + '”: ' + e.message);
      }
    });
  }

  function pickFile(accept) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => { if (input.files && input.files[0]) loadFile(input.files[0]); };
    input.click();
  }

  // Drop a .gantt / .json / .csv file anywhere on the page to open it.
  document.addEventListener('dragover', (e) => { e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  function saveFile() {
    const d = gantt.getData();
    const name = (d.title || 'plan').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'plan';
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + '.gantt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const gantt = LocalGantt.create(document.getElementById('app'), {
    data: stored || LocalGantt.sampleData(),
    onChange: persist,
    toolbarExtras: [
      { label: 'New', title: 'Start a new, empty plan', onClick: () => {
        if (confirm('Start a new empty plan? The current plan will be replaced (use “Save…” first to keep a copy).')) {
          gantt.replaceData(LocalGantt.blankData());
        }
      } },
      { label: 'Open…', title: 'Open a .gantt or .csv file (you can also drop a file onto the page). Ctrl/Cmd+Z undoes it.', onClick: () => pickFile('.gantt,.json,.csv,text/csv,application/json') },
      { label: 'Import CSV…', title: 'Import a CSV export from onlinegantt.com (Outline Level, Name, Start, Finish, …). Ctrl/Cmd+Z undoes it.', onClick: () => pickFile('.csv,text/csv') },
      { label: 'Save…', title: 'Download this plan as a .gantt file (works with the Obsidian plugin too)', onClick: saveFile },
      { label: 'Print', title: 'Print or save as PDF', onClick: () => window.print() },
    ],
  });
  persist(gantt.getData());
})();
