# Remote access to your Claude Code / development session

Goal: see and resume the Claude Code session running on the Mac mini from your phone (or any other machine).

There are 3 layers — pick the depth you want:

1. **LAN-only** (same WiFi as the Mac mini) — easiest, 5 min
2. **External** (anywhere with internet) — needs Tailscale or Cloudflare Tunnel — 15 min
3. **Web app fallback** — claude.ai mobile, separate session — 30 sec

---

## 1. LAN-only setup (start here)

### On the Mac mini

1. **Enable SSH server**
   - System Settings → General → Sharing → toggle **Remote Login** ON
   - Note the username and IP shown (e.g. `radu-server@192.168.1.42`)

2. **Set a password (or use SSH key)**
   - Password is fine for LAN. For external access, use SSH keys.

3. **Confirm screen sessions are running**
   ```bash
   screen -ls
   ```
   You should see `60097.amass` (or whatever your session is named).

### On your phone

#### iOS

- **Termius** (App Store, free tier sufficient): create new host, enter `radu-server@192.168.1.42`, password.

#### Android

- **Termux** (F-Droid recommended, Play Store may have stale version):
  ```bash
  pkg install openssh
  ssh radu-server@192.168.1.42
  ```
- Or **Termius** for Android — same as iOS.

### Reattach to the Claude Code session

Once SSH'd in:

```bash
# List sessions
screen -ls

# Reattach to the named session
screen -r 60097.amass
# Or by short name
screen -r amass

# If "Already attached" — kick out the previous attach and take over:
screen -d -r amass
```

You'll see exactly what I see — every line of output, every prompt, every tool call. Type to send to Claude Code.

### Detach without killing the session

`Ctrl+A` then `D` — detaches. Claude Code keeps running.

---

## 2. External access (anywhere with internet)

LAN access only works from your home WiFi. For coffee shops, work, travel — pick one of these.

### Option A: Tailscale (recommended)

Tailscale puts your Mac and phone on a private mesh VPN. No port forwarding, no public IP.

1. **On Mac**: install Tailscale from <https://tailscale.com/download/mac>, sign in with Google/GitHub.
2. **On phone**: Tailscale app from App Store / Play Store, same account.
3. SSH using the Tailscale hostname (`100.x.y.z` IP or `mac-server.tailnet-name.ts.net` magic DNS).

Free tier: 100 devices, fine for personal use.

### Option B: Cloudflare Tunnel (if you have a Cloudflare account)

Already running for the demo URL. Add an SSH service:

```bash
# On Mac
cloudflared tunnel login
cloudflared tunnel create amass-ssh
cloudflared tunnel route dns amass-ssh ssh.<your-domain>
cloudflared tunnel run --url ssh://localhost:22 amass-ssh
```

Then on phone, SSH client uses `ssh://ssh.<your-domain>`. Needs `cloudflared access ssh` on the client side or use a TCP tunnel. **More setup than Tailscale.**

### Option C: Just a port-forward (NOT recommended)

Open port 22 on your router → public internet. Don't. Bots will hammer you. Use Tailscale.

---

## 3. claude.ai web app fallback

If the screen reattach is too much friction:

- iOS: Claude app from App Store
- Android: Claude app from Play Store
- Or claude.ai in any mobile browser

This is a **separate** Claude conversation — it cannot see the Claude Code session running on your Mac. It can:
- Answer questions
- Help draft prompts to paste into your Mac session later
- Review code if you paste it manually

It cannot:
- Run `git`, `pnpm`, `docker` on your Mac
- See your file system
- Resume the screen session

Use it as a thinking buddy on the bus, not as your dev environment.

---

## Cheat sheet

```bash
# Mac: list and start screen sessions
screen -ls
screen -S amass-backend       # named session
screen -dmS bg-task <command> # detached background

# Detach: Ctrl+A then D
# Reattach: screen -r <name>
# Kill stuck attach: screen -d -r <name>
# Kill session entirely: screen -X -S <name> quit

# SSH from phone
ssh radu-server@192.168.1.42                        # LAN
ssh radu-server@100.96.42.7                         # Tailscale
ssh radu-server@mac-server.tailnet-xxx.ts.net       # Tailscale magic DNS

# Inside session, refresh repo state
cd ~/amass-crm-v2
git status
gh run list --limit 5
```

---

## Common pitfalls

- **"Connection refused" on LAN**: Remote Login isn't enabled, or Mac is asleep. System Settings → Battery → "Prevent automatic sleeping when display is off" + plug in.
- **"Password login disabled"**: macOS may require SSH key auth. Generate one on phone and add to `~/.ssh/authorized_keys` on Mac.
- **Session shows blank screen**: terminal size mismatch. Press `Ctrl+A` then `:resize` inside screen, or just detach + reattach.
- **Claude Code stops responding**: it might be waiting on a prompt. Press Enter inside the session.
- **Mac mini IP changes**: assign a static DHCP lease in your router, or use Tailscale magic DNS.
