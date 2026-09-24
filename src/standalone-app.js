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

  function openFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gantt,.json,application/json';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      file.text().then((text) => {
        try {
          gantt.setData(JSON.parse(text));
          persist(gantt.getData());
        } catch (e) {
          alert('Could not open that file: ' + e.message);
        }
      });
    };
    input.click();
  }

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
          gantt.setData(LocalGantt.blankData());
          persist(gantt.getData());
        }
      } },
      { label: 'Open…', title: 'Open a .gantt / .json file', onClick: openFile },
      { label: 'Save…', title: 'Download this plan as a .gantt file (works with the Obsidian plugin too)', onClick: saveFile },
      { label: 'Print', title: 'Print or save as PDF', onClick: () => window.print() },
    ],
  });
  persist(gantt.getData());
})();
