# TradeOS PWA

## Setup Instructions

### 1. Update Apps Script
- Open your Apps Script project (Copy of Trading Journal)
- Replace the `doGet` function with the contents of `api_update.gs`
- Add the `doPost` and `jsonResponse` functions
- Save and redeploy as a new version

### 2. Push to GitHub
```bash
cd tradeos
git init
git add .
git commit -m "TradeOS PWA initial build"
git remote add origin https://github.com/gordon-foustiii/tradeos.git
git push -u origin main
```

### 3. Enable GitHub Pages
- Go to your repo on GitHub
- Settings → Pages
- Source: Deploy from branch → main → / (root)
- Save

### 4. Add Icons
- Create two PNG icons and place in /icons/
  - icon-192.png (192x192)
  - icon-512.png (512x512)

### 5. Install on Android
- Open https://gordon-foustiii.github.io/tradeos/ in Chrome
- Tap three dots → Add to Home screen
- Opens fullscreen, no browser bar

## File Structure
```
tradeos/
├── index.html        # Home
├── journal.html      # Trade Journal
├── candies.html      # Candies
├── calculator.html   # Calculator
├── playbook.html     # Playbook
├── notes.html        # Notes
├── manifest.json     # PWA manifest
├── sw.js             # Service worker
├── css/
│   └── app.css       # All styles
├── js/
│   ├── api.js        # Apps Script API calls
│   └── nav.js        # Navigation + SW registration
└── icons/
    ├── icon-192.png
    └── icon-512.png
```
