# TabRescue 🛡️

**TabRescue** is a lightweight extension for Microsoft Edge (and Chromium-based browsers) designed to solve a critical configuration conflict: when the browser is set to **clear browsing history on exit**, but the user wishes to **keep their tabs and groups open**.

## 🚀 The Problem

Normally, if you enable history clearing on close, Edge purges session data before the native "Continue where you left off" feature can load it. This results in the total loss of your tabs and group organization every time you restart the browser.

## ✨ Solution

TabRescue implements a proactive and independent saving system:

- **Multi-Monitor & Multi-Window Support:** Restores each window independently on its respective monitor using saved coordinates (`left`, `top`, dimensions, and maximized state).
- **Sequential Close Protection:** 60-second grace buffer when closing windows one by one using the "X" button, preventing accidental session loss on shutdown.
- **Group Persistence:** Keeps names, colors, and collapsed states of tab groups intact per window without cross-window merging.
- **Pinned Tabs:** Preserves pinned tab state across restarts.
- **Interactive Toolbar GUI:** Clean, dark glassmorphism popup displaying live window/tab/group counts, monitor distribution, last saved timestamp, and one-click manual save/restore buttons.
- **Smart Saving:** Utilizes an optimized _debounce_ system (1.5s) to save changes reliably without affecting performance.
- **Clean Startup:** Recycles the browser's initial tab to avoid unnecessary empty windows.

## 🛠️ Installation

1. Download the `background.js` and `manifest.json` files into a local folder.
2. Open Edge and navigate to `edge://extensions/`.
3. Enable **"Developer mode"**.
4. Click on **"Load unpacked"** and select the folder containing the files.

## 📝 License

This project is distributed under the **TabRescue Personal Use License (TPUL)**. See the `LICENSE.md` file for more details. TabRescue Personal Use License (TPUL) - Strictly for personal use only.

---
