# Blue Horizon Squadron — bhs.github.io

Official website for **Blue Horizon Squadron**, an elite DCS (Digital Combat Simulator) virtual squadron.

![BHS Website](https://github.com/user-attachments/assets/bb733f74-5187-46a4-8097-18ddae907112)

## Features

- 🏠 **Home page** — hero, patches showcase, features overview, upcoming operations, Discord CTA
- 📋 **Operations** — list upcoming ops with date/time/difficulty/slots, filter by status, and register via modal form
- 👥 **Members** — pilot roster driven by `_data/members.yml`
- 📰 **News** — Jekyll posts for announcements and mission reports
- ℹ️ **About** — squadron history, units, aircraft, disclaimer
- 💬 **Discord integration** — join button in nav, server widget, and webhook-based registration notifications

## Quick Start

### Prerequisites

- Ruby 3.x
- Bundler

```bash
gem install bundler
```

### Local Development

```bash
# Install dependencies
bundle install

# Serve locally
bundle exec jekyll serve

# Open http://localhost:4000
```

### Production Build

```bash
bundle exec jekyll build
```

The site is automatically deployed to GitHub Pages via the included Actions workflow whenever you push to `main`.

## Configuration

Edit `_config.yml` to set up your squadron:

```yaml
squadron:
  name: "Blue Horizon Squadron"
  designation: "VF-1"
  discord_invite: "https://discord.gg/YOUR-CODE"       # ← Replace
  discord_widget_id: "YOUR_DISCORD_SERVER_ID"           # ← Replace
  discord_webhook: "https://discord.com/api/webhooks/…" # ← Optional
```

### Discord Webhook (Registration Notifications)

1. In your Discord server: **Server Settings → Integrations → Webhooks → New Webhook**
2. Choose the channel where registrations should appear
3. Copy the webhook URL
4. Paste it into `discord_webhook` in `_config.yml`

When set, every operation registration form submission posts a rich embed to your Discord channel.

### Discord Widget

1. In your Discord server: **Server Settings → Widget → Enable Server Widget**
2. Copy the **Server ID** shown on that page
3. Set `discord_widget_id` in `_config.yml`

## Content Management

### Adding an Operation

Edit `_data/operations.yml` and add a new entry:

```yaml
- id: op-004
  codename: "OPERATION EXAMPLE"
  title: "Mission Title"
  theater: "Caucasus"
  map: "Caucasus"
  status: "upcoming"          # upcoming | active | planning | completed | cancelled
  date: "2026-06-01"
  time: "19:00 UTC"
  duration: "2–3 hours"
  difficulty: "Intermediate"
  slots_total: 8
  slots_filled: 0
  description: "Mission briefing text."
  objectives:
    - "Objective one"
  roles:
    - name: "Flight Lead"
      aircraft: "F/A-18C Hornet"
      slots: 1
      filled: 0
  tags:
    - "Caucasus"
```

### Adding a Member

Edit `_data/members.yml`:

```yaml
- callsign: "Wolf"
  name: "Cpt. J. Smith"
  role: "Pilot"
  rank: "Captain"
  aircraft:
    - "F/A-18C Hornet"
  status: "active"
  initials: "JS"
  joined: "2025"
```

### Adding a News Post

Create a file in `_posts/` following the naming convention `YYYY-MM-DD-title.md`:

```markdown
---
layout: post
title: "Post Title"
date: 2026-01-01 12:00:00 +0000
category: "Announcement"
tags: [DCS, Operations]
---

Your post content here.
```

## Squadron Assets

| Image | Usage |
|-------|-------|
| `assets/images/eagle-insignia.png` | Nav logo, favicon, footer |
| BHS Digital Patch | Squadron patch (homepage, about, members) |
| Golden Falcons Patch | Display team section (about) |
| Black Flag — Caucasus | Operation patch (op-001) |

## Deployment

The site deploys automatically via **GitHub Actions** (`.github/workflows/deploy.yml`) on every push to `main`. Ensure **GitHub Pages** is enabled in your repository settings with the source set to **GitHub Actions**.

## License

&copy; Blue Horizon Squadron. All rights reserved.  
This is a fictional virtual squadron website for use with DCS World. Not affiliated with any real military organisation.
