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
