document.addEventListener('DOMContentLoaded', () => {
  const downloadBtn = document.getElementById('download-btn');

  if (downloadBtn) {
    downloadBtn.addEventListener('click', async () => {
      downloadBtn.innerText = '⏳ Bundling Extension...';

      try {
        // Load JSZip library dynamically if not present
        if (typeof JSZip === 'undefined') {
          await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
        }

        const zip = new JSZip();
        const extensionFolder = zip.folder("extension");

        // Fetch extension files to pack into the zip
        const filesToZip = [
          { path: 'extension/manifest.json', zipPath: 'extension/manifest.json' },
          { path: 'extension/popup.html', zipPath: 'extension/popup.html' },
          { path: 'extension/popup.css', zipPath: 'extension/popup.css' },
          { path: 'extension/popup.js', zipPath: 'extension/popup.js' },
          { path: 'extension/content.js', zipPath: 'extension/content.js' }
        ];

        for (const file of filesToZip) {
          try {
            const response = await fetch(file.path);
            if (response.ok) {
              const text = await response.text();
              zip.file(file.zipPath, text);
            }
          } catch (e) {
            console.warn("Fetch failed for", file.path, e);
          }
        }

        // Add README inside zip
        zip.file("extension/README.txt", `Wordle AI Auto-Solver Extension
====================================
How to Install in Chrome:
1. Open Google Chrome.
2. Go to chrome://extensions
3. Enable 'Developer mode' in the top-right corner.
4. Click 'Load unpacked' in top-left.
5. Select this 'extension' folder.

Created by Ninaad Saxena (https://linkedin.com/in/ninaadsaxena)
`);

        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "wordle-solver-extension.zip";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        downloadBtn.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Downloaded! (Unzip & Load)
        `;
        setTimeout(() => {
          downloadBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Download Extension (.zip)
          `;
        }, 4000);

      } catch (err) {
        console.error("ZIP packaging error:", err);
        alert("Preparing zip file download...");
        downloadBtn.innerHTML = `Download Extension (.zip)`;
      }
    });
  }
});

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ─── Wordle Demo Board Animation ───────────────────────────────────────────
// Mimics real NYT Wordle: letter pop-in when typed, tile flip + color reveal
// when submitted, bounce on the winning row, then loops.

const DEMO_GUESSES = [
  { word: 'RAISE', colors: ['gray', 'gray', 'gray', 'yellow', 'green'] },
  { word: 'STOLE', colors: ['green', 'gray', 'yellow', 'yellow', 'green'] },
  { word: 'SOLVE', colors: ['green', 'green', 'green', 'green', 'green'] },
];

const LETTER_DELAY   = 160;  // ms between each letter pop-in
const FLIP_DELAY     = 300;  // ms between each tile flip within a row
const ROW_PAUSE      = 600;  // ms pause after a row is revealed before starting next
const LOOP_PAUSE     = 2800; // ms to show the solved board before resetting
const FLIP_HALF      = 250;  // ms — must match CSS flip animation duration

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function tile(row, col) {
  return document.getElementById(`t${row}-${col}`);
}

function addAnim(el, cls, duration) {
  return new Promise(resolve => {
    el.classList.add(cls);
    setTimeout(() => {
      el.classList.remove(cls);
      resolve();
    }, duration);
  });
}

async function typeLetter(row, col, letter) {
  const el = tile(row, col);
  el.textContent = letter;
  // Add border highlight like real Wordle while typing
  el.style.borderColor = '#999';
  await addAnim(el, 'pop', 110);
}

async function flipRevealRow(row, colors, word) {
  for (let col = 0; col < 5; col++) {
    const el = tile(row, col);

    // Phase 1: flip out (tile goes to 90°)
    el.classList.add('flip-out');
    await sleep(FLIP_HALF);
    el.classList.remove('flip-out');

    // At the midpoint, apply the color
    el.classList.add(colors[col]);
    el.style.borderColor = '';

    // Phase 2: flip in (tile comes back from 90°)
    el.classList.add('flip-in');
    await sleep(FLIP_HALF);
    el.classList.remove('flip-in');

    if (col < 4) await sleep(FLIP_DELAY - FLIP_HALF * 2);
  }
}

async function bounceRow(row) {
  for (let col = 0; col < 5; col++) {
    const el = tile(row, col);
    el.classList.add('bounce');
    await sleep(80);
  }
  await sleep(500);
  for (let col = 0; col < 5; col++) {
    tile(row, col).classList.remove('bounce');
  }
}

function resetBoard() {
  const badge = document.getElementById('demo-badge');
  if (badge) badge.style.opacity = '0';

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      const el = tile(r, c);
      el.textContent = '';
      el.className = 'demo-tile';
      el.style.borderColor = '#565758';
    }
  }
}

async function runDemoLoop() {
  await sleep(800); // initial delay before first animation

  while (true) {
    resetBoard();

    for (let r = 0; r < DEMO_GUESSES.length; r++) {
      const { word, colors } = DEMO_GUESSES[r];

      // Type letters one by one with pop
      for (let c = 0; c < 5; c++) {
        await typeLetter(r, c, word[c]);
        await sleep(LETTER_DELAY);
      }

      await sleep(280); // brief pause before flipping (simulates Enter press)

      // Flip each tile and reveal color
      await flipRevealRow(r, colors, word);

      // Bounce if this is the winning row
      if (colors.every(c => c === 'green')) {
        await sleep(200);
        await bounceRow(r);
      } else {
        await sleep(ROW_PAUSE);
      }
    }

    // Show "Solved" badge
    const badge = document.getElementById('demo-badge');
    if (badge) badge.style.opacity = '1';

    await sleep(LOOP_PAUSE);
  }
}

// Kick off the looping animation when the page loads
document.addEventListener('DOMContentLoaded', () => {
  runDemoLoop();
});
