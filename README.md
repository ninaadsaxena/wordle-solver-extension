# 🟩🟨⬛ Wordle AI Solver — Standalone Chrome Extension & Landing Page

An Information-Entropy & Datamuse AI Wordle Auto-Solver packaged as a standalone Manifest V3 Chrome Extension, accompanied by a Vercel-ready landing page.

---

## 🚀 Project Overview

This repository contains two main parts:

1. **`extension/`**: The standalone Chrome Extension (Manifest V3).
   - **Zero dependencies** (no Python, Node.js, or backend servers needed).
   - **Live Datamuse API** Integration for dynamic candidate matching.
   - **Shannon Entropy Engine** running 100% in client-side JavaScript.
   - **Mid-Game Resume & Auto-Rejection Handling**.
   - **Randomized Top Openers**: (`CRANE`, `SLATE`, `STARE`, `ROATE`, `RAISE`, `TRACE`, `SNARE`, `ARISE`, `SALET`, `TALER`).

2. **Landing Page (`index.html`, `style.css`, `script.js`)**:
   - Modern glassmorphism UI ready to deploy directly to **Vercel** or **GitHub Pages**.
   - One-click **"Download Extension (.zip)"** button.
   - Interactive 3-step installation guide for users.
   - Creator profile section featuring **Ninaad Saxena** with links to [LinkedIn](https://linkedin.com/in/ninaadsaxena) and [GitHub](https://github.com/ninaadsaxena).

---

## 🛠️ How to Install the Extension in Chrome

1. **Download & Extract**:
   - Download the `extension` folder or click **Download Extension (.zip)** on the landing page and unzip it.

2. **Open Chrome Extensions**:
   - Open Google Chrome and navigate to `chrome://extensions` (or go to `Settings -> Extensions`).

3. **Enable Developer Mode**:
   - Toggle the **Developer mode** switch in the top-right corner to **ON**.

4. **Load Unpacked**:
   - Click the **Load unpacked** button in the top-left corner.
   - Select the `extension` folder from this repository.

5. **Run**:
   - Click the extension icon in Chrome and click **🚀 Run Auto-Solver** while on NYT Wordle!

---

## 🌐 Deploying the Landing Page to Vercel

1. **Push this repository to GitHub**:
   ```bash
   git add .
   git commit -m "Add Chrome Extension and Vercel Landing Page"
   git push -u origin main
   ```

2. **Deploy on Vercel**:
   - Go to [Vercel](https://vercel.com/new).
   - Import your `wordle-solver-extension` repository.
   - Click **Deploy** (no build command needed, it's static HTML/CSS/JS!).

---

## 👤 Author

**Ninaad Saxena**
- 💼 LinkedIn: [linkedin.com/in/ninaadsaxena](https://linkedin.com/in/ninaadsaxena)
- 🐙 GitHub: [github.com/ninaadsaxena](https://github.com/ninaadsaxena)
