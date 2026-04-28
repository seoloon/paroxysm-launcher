# Paroxysm Launcher

<p align="center">
  <img src="assets/logo_bckg.png" alt="Paroxysm Launcher Logo" width="96" />
</p>

<p align="center">
  Peak simplicity for modded Minecraft.
</p>

<p align="center">
  <a href="https://paroxysm.seoloon.work/"><img src="https://img.shields.io/badge/Website-paroxysm.seoloon.work-22D3EE?style=for-the-badge" alt="Website" /></a>
  <a href="https://discord.gg/MwVPxNXych"><img src="https://img.shields.io/badge/Discord-Join%20Server-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="https://www.youtube.com/@paroxysm_launcher"><img src="https://img.shields.io/badge/YouTube-Paroxysm%20Launcher-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="YouTube" /></a>
  <a href="mailto:contact@seoloon.work"><img src="https://img.shields.io/badge/Contact-contact%40seoloon.work-0EA5E9?style=for-the-badge&logo=gmail&logoColor=white" alt="Contact" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/seoloon/paroxysm-launcher?display_name=tag&style=flat-square" alt="Latest Release" />
  <img src="https://img.shields.io/github/license/seoloon/paroxysm-launcher?style=flat-square" alt="License" />
  <img src="https://img.shields.io/badge/Electron-28.x-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/Minecraft-Java-62B47A?style=flat-square" alt="Minecraft Java" />
</p>

---

## Preview

![Paroxysm Launcher Preview](assets/preview2.png)

---

## Why Paroxysm

Paroxysm is a desktop Minecraft launcher focused on:

- Fast startup and smooth UX
- Open-source transparency
- Clean, no-bloat workflow
- Direct modding workflows through integrated browsing and instance tools

---

## Features

- Microsoft authentication (Device Code Flow)
- Modrinth browser integration (mods, resource packs, shaders, modpacks)
- One-click add-content workflow for compatible instances
- Instance creation: Vanilla, Forge, NeoForge, Fabric, Quilt
- Per-instance settings (RAM, identity, icon, notes)
- Instance content explorer with filtering and search
- Strict "already installed" detection for quick add-content
- CurseForge import and name resolution improvements
- Discord Rich Presence
- Auto-update channels (Stable / Beta) via GitHub Releases

---

## Tech Stack

- Electron
- Vanilla HTML/CSS/JS renderer
- `electron-builder` for packaging
- `electron-updater` for update delivery

---

## Getting Started

### Requirements

- Node.js 18+ (recommended LTS)
- npm
- Windows for current playtest target

### Install

```bash
npm install
```

### Run (dev)

```bash
npm run dev
```

### Run (normal)

```bash
npm start
```

---

## Build

```bash
npm run check
npm run build:win
```

Other targets:

```bash
npm run build:linux
npm run build:mac
npm run build:all
```

---

## Release and Updates

Paroxysm is configured for GitHub-based publishing with two channels:

- Stable
- Beta

Update artifacts are generated for all channels (`generateUpdatesFilesForAllChannels: true`).

---

## Project Links

- Website: [paroxysm.seoloon.work](https://paroxysm.seoloon.work/)
- Discord: [discord.gg/MwVPxNXych](https://discord.gg/MwVPxNXych)
- YouTube: [@paroxysm_launcher](https://www.youtube.com/@paroxysm_launcher)
- Contact: [contact@seoloon.work](mailto:contact@seoloon.work)

---

## License

This project is licensed under the GNU GPL v3 License.  
See [LICENSE.md](LICENSE.md) for details.

