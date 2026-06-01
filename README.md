# ValoVault

ValoVault is a premium desktop application that allows you to create, save, and apply your favorite weapon skin loadouts in VALORANT, automatically apply them to selected agents, and view your Riot Storefront (Daily Offers, Night Market, Bundles, and Wallet) without opening the game client.

<img width="1666" height="937" alt="image" src="https://github.com/user-attachments/assets/f617d5d8-93b8-46e2-965e-d466f1fdad79" />

## Download

**[Download ValoVault v0.4.0 for Windows (64-bit)](https://github.com/akawazak/valo-project/releases/download/v0.4.0/ValoVault_0.4.0_x64_en-US.msi)**

See all releases: [github.com/akawazak/valo-project/releases](https://github.com/akawazak/valo-project/releases)

---

## ✨ Features

### 🎒 Skin Loadout & Presets (Core)
- **Create Presets:** Save your favorite combinations of weapon skins and gun buddies as custom presets.
- **Apply Presets:** Quickly apply any saved preset to your current loadout with a single click.
- **Agent-Specific Presets:** Assign different presets to your favorite agents.
- **Auto-Apply (Optional):** Enable "Auto Select Agent" to automatically apply a preset when you lock in an agent in-game.

### 🛒 Riot Storefront Viewer (New!)
- **Daily Offers:** View your 4 daily weapon skin offers with authentic Content Tier colored rarity cards, custom glowing borders, and tier rarity icons.
- **Night Market Container:** A beautiful, fully styled neon cyan and pink Night Market panel with discount calculations, countdown timer, and original-vs-discounted prices.
- **Featured Bundles:** View high-resolution promotional bundle banners and their included items (skins, cards, buddies, sprays) with their precise discounted bundle pricing.
- **Wallet Balances:** Live display of your active Valorant Points (VP) and Radianite Points (RP) directly inside the store header.
- **Ownership Badging:** A distinct, glowing green `OWNED` badge shows up automatically on any skin or bundle item you already own.

### 👥 Premium Multi-Account Panel (New!)
- **Dynamic Navigation Sidebar:** A glassy, high-fidelity dark left-hand navigation sidebar that organizes and separates your settings.
- **Instant Account Switcher:** Keep multiple Riot accounts connected and hot-swap between them seamlessly. Switching accounts updates the storefront, wallet, and presets instantly without jarred page reloads.
- **Secure Local Storage:** Authentication tokens and accounts are stored securely in local app storage.
- **Session Expiry Alerts:** Graceful `401 Session Expired` alerts tell you when it's time to reconnect, avoiding raw API errors.
- **Account Disconnect Dialog:** A premium custom delete dialog with a "Don't ask again" option to speed up workflow.

---

## 💖 Credits & Acknowledgements

ValoVault was built by combining, upgrading, and expanding two outstanding open-source projects. We express our deep appreciation to the original authors:

1. **[truearken/valovault](https://github.com/truearken/valovault)**  
   The wonderful foundation for the preset manager, Go client-binding bridge, and Tauri desktop integration.

2. **[victorxia18/valorant-shop-checker](https://github.com/victorxia18/valorant-shop-checker)**  
   Inspiration and basic patterns for the Riot OAuth token paste-redirect authentication flow and fetching the raw daily storefront. *(Note: All premium features including multi-account registries, live wallet balances, content tier rarity styles, Night Market container, and session-state management were built entirely from scratch for ValoVault).*

---

## 🚀 Setting Up Your Own Repository

To dump this upgraded codebase into your own new GitHub repository:

1. Create a new empty repository on [GitHub](https://github.com/new).
2. Open your terminal in the `valovault` root directory.
3. Update your git remote to point to your new repository:
   ```sh
   git remote set-url origin <YOUR_NEW_GITHUB_REPO_URL>
   ```
4. Push your changes:
   ```sh
   git add .
   git commit -m "feat: upgrade ValoVault with premium storefront and multi-account sidebar"
   git push -u origin main
   ```

---

## 🛠️ Developer Setup

### Prerequisites
- [Go](https://go.dev/doc/install)
- [Node.js](https://nodejs.org/en/download)
- [Tauri](https://tauri.app/start/prerequisites/)

### Setup & Running

1. **Install frontend dependencies:**
   ```sh
   cd frontend
   npm install
   ```

2. **Run the Go Backend:**
   Open a terminal in the `backend/` directory:
   ```sh
   go run .
   ```
   *(Or `air` if you have live-reloading configured)*.

3. **Run the Frontend (with Tauri):**
   Open a terminal in the `frontend/` directory:
   ```sh
   npx tauri dev
   ```
   This compiles the backend, runs the Next.js development server on `http://localhost:3000`, and launches the native desktop app.

