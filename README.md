# 🟩🟨⬛ Wordle AI Solver — Browser Extension & Landing Page

An Information-Entropy & Datamuse AI Wordle Auto-Solver packaged as a zero-dependency **Manifest V3 Chrome Extension**, with a Vercel-ready landing page for distribution.

Works on any Chromium-based browser: **Chrome, Microsoft Edge, Brave, Opera, Vivaldi**.

🔗 **Live Site**: [wordle-solver-extension.vercel.app](https://wordle-solver-extension.vercel.app/)

---

## 🚀 Features

- **One-Click Auto-Solver**: Click the extension icon on NYT Wordle and watch it solve the puzzle automatically — no manual input needed.
- **Shannon Entropy Engine**: Calculates the expected information gain (in bits) for every candidate word to always pick the optimal next guess.
- **Datamuse Live API**: Dynamically fetches valid word candidates from the Datamuse API using known letter patterns — no local dictionary file needed.
- **Auto-Dismiss Modals**: Automatically closes NYT cookie banners, privacy popups, and "How to Play" tutorials before solving.
- **Mid-Game Resume**: Reads existing tile colours on the board and picks up from wherever you left off.
- **Rejection Auto-Clear**: Detects when Wordle rejects a word (invalid dictionary entry), clears the row with Backspace, and retries automatically.
- **Randomized Top Openers**: Randomly selects from 10 mathematically optimal opening guesses to maximise first-turn information gain.

---

## 📁 Project Structure

```
wordle-solver-extension/
├── extension/                  # The Chrome Extension (Manifest V3)
│   ├── manifest.json           # Extension config, permissions & content script registration
│   ├── popup.html              # Extension popup UI
│   ├── popup.css               # Popup styling
│   ├── popup.js                # Popup logic (sends START_SOLVER message to content script)
│   └── content.js              # Core solver engine injected into NYT Wordle page
├── assets/                     # Static assets for the landing page
│   ├── logos/                  # Browser logo SVGs (Chrome, Edge, Brave, Opera)
│   └── ninaad.png              # Creator photo
├── index.html                  # Vercel landing page
├── style.css                   # Landing page styles
├── script.js                   # Landing page JS (download zip + demo board animation)
└── README.md
```

---

## 🛠️ How to Install the Extension

### Chrome / Brave / Opera / Vivaldi

1. **Download & Extract**:
   - Download the `.zip` from the [landing page](https://wordle-solver-extension.vercel.app) and right-click → **Extract All**.

2. **Enable Developer Mode**:
   - Open `chrome://extensions` and toggle **Developer mode** ON in the top-right corner.

3. **Load Unpacked**:
   - Click **Load unpacked** and select the extracted `extension` folder.

4. **Pin & Run**:
   - Click the puzzle-piece icon in your browser bar, pin the extension, then open [NYT Wordle](https://www.nytimes.com/games/wordle/index.html) and click **🚀 Run Auto-Solver**.

### Microsoft Edge

Same steps as above, but navigate to `edge://extensions` instead of `chrome://extensions`.

> **Edge tip**: Once installed, you can turn Developer Mode **off** and the extension will continue running normally — Edge is more permissive with locally loaded extensions than Chrome.

> **Note**: Do **not** delete the extracted folder. Browsers read the extension files directly from disk. You can move the folder anywhere permanent (e.g. Documents), but it must stay on your machine.

---

## 💡 How It Works

The solver evaluates guesses by maximising **Shannon Entropy** $H(X)$:

$$H(X) = - \sum_{i} P(x_i) \log_2 P(x_i)$$

For each legal candidate word, it simulates how the remaining candidates would be split across all possible 243 colour feedback patterns ($3^5$). The word that produces the most uniform distribution — and thus the highest expected information gain in bits — is chosen as the next guess.

The engine runs entirely in the browser via a Manifest V3 content script. No backend server, no Python, no setup beyond loading the extension folder.

---

## 🎯 Top Optimal Opening Guesses

To skip the expensive first-turn calculation (which would require evaluating ~100M word pairs), the solver randomly selects from a curated list of 20 top mathematical and popular player openers:

```js
const TOP_OPENERS = [
  "SALET", "TRACE", "CRANE", "CRATE", "SLATE",
  "STARE", "RAISE", "SNARE", "AROSE", "LEAST",
  "ADIEU", "AUDIO", "ARISE", "HOUSE", "TRAIN",
  "IRATE", "GREAT", "HEART", "DREAM", "OCEAN"
];
```

### Why these words?

1. **Entropy Ranking**: Based on Information Theory research (including Grant Sanderson / 3Blue1Brown and MIT benchmarks), these words yield the highest expected information gain (~5.75–5.84 bits) across all ~13,000 legal 5-letter English words.
2. **Optimal Letter Frequencies**: Each word combines the top vowels (`E`, `A`, `I`/`O`) with the highest-frequency consonants (`R`, `S`, `T`, `N`).
3. **Candidate Reduction**: Any of these openers reduces the pool of ~2,309 official NYT Wordle answers to **fewer than 20 candidates on average** after just one guess.

| Word | Expected Information Gain | Avg. Candidates Remaining After Turn 1 |
| :--- | :---: | :---: |
| **SALET** | 5.836 bits | ~15 words |
| **ROATE** | 5.828 bits | ~16 words |
| **CRANE** | 5.787 bits | ~18 words |
| **TRACE** | 5.786 bits | ~18 words |
| **SLATE** | 5.785 bits | ~18 words |
| **RAISE / ARISE** | 5.778 bits | ~19 words |
| **SNARE** | 5.760 bits | ~20 words |
| **STARE / TALER** | 5.750 bits | ~21 words |

---

## 👤 Author

**Ninaad Saxena**
- 💼 LinkedIn: [linkedin.com/in/ninaadsaxena](https://linkedin.com/in/ninaadsaxena)
- 🐙 GitHub: [github.com/ninaadsaxena](https://github.com/ninaadsaxena)
