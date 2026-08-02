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
