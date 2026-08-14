# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two roles, treated as equally important: the **мастер** (GM), who preps and runs their own tabletop RPG campaigns, and their **active players**, who use the same app (via a role-branched mobile-adaptive web client) to view their characters, campaign info, upcoming sessions, and shared world content. This is a personal tool built by the GM for their own real group — not a multi-tenant SaaS product.

## Product Purpose

A personal, offline-first TTRPG campaign and session manager. It replaces ad hoc use of Notion/Obsidian for campaign prep and lore-keeping, and Roll20/D&D Beyond for session running and character sheets, with one tool purpose-built for this GM's specific play style: financially-tracked paid GMing, heavy homebrew content, and primarily in-person (offline) play. Currently supports D&D 5.5 and Legend in the Mist, with the compendium architecture designed to add more systems.

## Positioning

The mechanism a neighboring product (Notion, Obsidian, Roll20, D&D Beyond) could not truthfully copy without becoming this product:

- **Financial tracking is core, not bolted on.** Payment type, per-session rate, and amount-paid tracking live inside the campaign/session data model itself, for a GM who runs paid games.
- **Deep homebrew authoring with computed statblocks.** Classes, spells, items, bestiary, and mechanics are structured compendium data; character/creature statblocks compute AC, spell slots, and bonuses from that data rather than being free-text sheets.
- **Built-in music/audio player** (crossfade, per-session/setting playlists) — a feature rarely supported by offline-first tools, present here because in-person sessions need table music.
- **Offline-first, self-hosted.** The GM's desktop Electron app runs its own local Express+SQLite server and is fully editable with zero dependency on any external service. A hosted server is an optional sync layer for player mobile access, never a required backend for the GM.
- **Real-time session pult** (control panel): initiative tracker, second-monitor panel layout, "show image to players" broadcast — built for running the table live, not just prepping beforehand.
- **One shared, role-branching client.** GM and player use the same mobile-responsive codebase with different role permissions, not separate apps — and the whole design center of gravity is in-person/offline play, with online play treated as a secondary "helper/archive" mode. Most competitors (Roll20, D&D Beyond) default the other way, online-first.

## Operating Context

The GM prepares between sessions — editing campaigns, sessions, settings/lore, and system compendium content, typically on desktop. During a live session at a physical table, the GM runs the session pult (initiative tracker, second-monitor panel layout, image broadcast, session music) and may also reach for the phone. Both GM and players check the mobile-adaptive client on phones before, during, and between sessions for character sheets, schedules, and shared campaign content. Real, in-use campaign data is live in the production database concurrently with ongoing development — migrations and feature work must never corrupt it.

## Capabilities and Constraints

- Two account roles, **gm** and **player**, sharing one codebase (`client/`) that branches its UI by role — no separate apps exist or should be created.
- The GM's desktop Electron app must remain fully offline-editable indefinitely, even as server-based sync features are added — it must never degrade into a thin client of a remote server. This is an explicit, confirmed constraint, not a default assumption.
- Systems currently modeled: D&D 5.5 (deep, computed statblocks) and Legend in the Mist; the compendium architecture is designed to extend to further systems.
- Long Story Short (LSS) JSON character-sheet import goes directly into structured character statblocks.
- Desktop app auto-updates via GitHub Releases + electron-updater, with user confirmation before install.
- Real campaign data (e.g. Вотердип, Нестиум, Эстария campaigns) is live in production — never invent fabricated sample data when real examples are needed; use real in-app entity names or clearly-marked placeholders instead.
- The mobile experience is under active, iterative redesign (bottom nav, D&D-Beyond-style mobile character sheet, mobile Library/Players/Session views) — see `.impeccable/critique/` for the latest recorded findings and backlog.

## Brand Commitments

App name: **SoyMan** ("SoyMan TTRPG Manager" per README). No further binding visual or voice constraints have been established yet.

## Evidence on Hand

`README.md` at the repo root documents features and repo structure. The live SQLite database contains real, in-use campaign/session/player/character data — this is genuine content, not test fixtures; treat it as evidence of real usage patterns (e.g. real entity names, real session cadence) rather than fabricating sample data for future design work.

## Product Principles

1. **Offline-first, self-hosted.** The GM's local install must always work fully with zero remote dependency; server sync is additive, never required.
2. **Structured over free-text.** Statblocks, finances, and campaign data model real TTRPG mechanics computationally (AC, spell slots, earnings) rather than as prose notes — this is the core differentiator from wiki-style tools like Obsidian/Notion.
3. **One client, role-branched.** GM and player experiences share one mobile-responsive codebase; new capability is added by branching role, never by forking a separate app.
4. **Built for the table, not just for prep.** Real-time session-running tools (pult, initiative tracker, second-monitor panels, image broadcast, in-session music) are first-class, not an afterthought bolted onto a note-taking tool.
5. **In-person play is the default case.** Online/remote play is a secondary, "helper/archive" mode — when a design decision must pick a side, favor the physical-table experience.

## Accessibility & Inclusion

No specific accessibility requirement has been established by the user beyond general good practice.
