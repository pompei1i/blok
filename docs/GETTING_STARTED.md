# Getting started with blok

New here? This is the short path from "I just found this" to "I'm talking to my friends."
It takes about five minutes and you don't need a server, a database, or a terminal.

> **Just want to use blok?** Install it and sign up — that's the whole setup. The official
> installers are built against the project's own backend, which is what "public beta" means
> here. Setting up your own backend is a separate, optional path: see
> [Self-hosting](SELF_HOSTING.md).

---

## 1. Install

Download from the [latest release](https://github.com/pompei1i/blok-releases/releases/latest)
and pick the file for your system:

| Your system | Download | How to run it |
|---|---|---|
| **Windows 10/11** | `blok_x.y.z_x64-setup.exe` | Double-click and follow the installer |
| **Ubuntu / Debian / Mint** | `blok_x.y.z_amd64.deb` | `sudo apt install ./blok_x.y.z_amd64.deb` |
| **Fedora / RHEL** | `blok-x.y.z-1.x86_64.rpm` | `sudo dnf install ./blok-x.y.z-1.x86_64.rpm` |
| **Any other Linux** | `blok_x.y.z_amd64.AppImage` | `chmod +x` it, then run it — no install needed |

There is no macOS build yet.

**Windows may warn you** that the publisher is unknown. blok is signed for its auto-updater
but not with a paid Microsoft code-signing certificate, so SmartScreen doesn't recognise it.
Choose *More info → Run anyway*, or verify the download yourself first — see the
[FAQ](FAQ.md#is-the-windows-warning-normal).

Once installed, blok keeps itself up to date. New versions are verified against the
project's signing key before they install, and you can check for one by hand in
**Settings → System**.

## 2. Create your account

On first launch you get a sign-in screen. Choose **Register** and fill in:

- **Username** — at least 3 characters. This is how people @mention you.
- **Email** — real one; it's how you recover the account.
- **Password** — at least 6 characters.

Forgot it later? **Forgot password?** on the login screen emails you a reset code that you
enter along with a new password.

Your display name, avatar, pronouns, status message and bio are all editable afterwards in
**Settings → Account** — the username you pick at signup is the permanent handle.

## 3. Find your way around

The layout is deliberately close to what you already know from other chat apps:

- **Top bar** — your servers, plus open group chats.
- **Left sidebar** — the channels of the selected server, grouped into categories.
  `#` channels are text, speaker-icon channels are voice.
- **Middle** — the conversation.
- **Right** — the member list (toggle it in **Settings → View**).
- **Bottom left** — you: mute, deafen, settings, store, quests.

The single most useful key is **`Ctrl` + `K`**. It opens a jump box that searches your
servers, channels and people at once — it's faster than clicking, everywhere in the app.

## 4. Get into a conversation

You have three ways in, depending on why you're here.

**Someone invited you.** They'll send you an invite code. Use **Join by Code** in the top
bar, paste it, done. Codes can be set to expire or to run out after a number of uses, so
use it while it's fresh.

**You want your own space.** Top bar → **Create Server**, give it a name and an optional
description. You're the owner, which means every permission, always. Then build it out:

1. Create channels — **Text** for conversation, **Voice** for talking. Group them into
   categories once you have a few.
2. Invite people — open the invite panel, **Generate New Code**, choose an expiry (1 day
   or 7 days) and a maximum number of uses, and share it. If you already know their
   username, **Add Member** by username skips the code entirely.
3. Set up roles — **Server settings → Roles**. See
   [Roles and moderation](USER_GUIDE.md#roles-and-permissions) when you get there.

**You just want to talk to one person.** Add them as a friend by username, then message or
call them directly — no server needed.

## 5. Turn on your microphone

Click a voice channel and you're in it; there's no "connect" step.

Before your first call, spend a minute in **Settings → Audio**:

- **Microphone Access** — on Windows this is an OS permission. If it says *access denied*,
  the **Open System Settings** button takes you straight to the right page.
- **Input Device / Output Device** — pick them explicitly rather than trusting "System
  Default", especially if you have a headset and speakers both plugged in.
- **Noise Suppression** and **Echo Cancellation** — leave both on unless you have a reason.
- **Noise Gate** — raise it if your keyboard or fan is audible, lower it if people say you
  cut out mid-word.

Then pick how you talk, in **Settings → Hotkeys**:

- **Open mic** (default) — you're live whenever you're unmuted.
- **Push to talk** — turn it on and hold **`Space`** to speak. It's ignored while you're
  typing in a text box, so it won't fire mid-message.

Either way, **`Ctrl` + `Shift` + `M`** mutes your mic and **`Ctrl` + `Shift` + `D`** deafens
you (mutes everyone else, and you with them).

Voice goes **directly between you and the other people** in the channel, not through a
server. That's good for latency and privacy, and it's why a strict corporate or campus
firewall can occasionally block it — the [troubleshooting guide](TROUBLESHOOTING.md#voice)
covers what to do.

## 6. Now try the rest

Nothing below is required, but it's the part people miss:

| Try this | Where |
|---|---|
| Ask **b.ai.t** to make channels or summarise a busy channel for you | b.ai.t button in the top bar |
| Turn on **auto-translation** and read the whole server in your own language | Settings → Language |
| **Share your screen** at up to 60 fps, with desktop audio | Screen icon inside a voice channel |
| Open a **kube** and equip what drops | Store, bottom left |
| Repaint the app — themes, chat background, custom CSS | Settings → Theme |

## Where to go next

- **[User guide](USER_GUIDE.md)** — every feature, explained properly
- **[FAQ](FAQ.md)** — is it free, is it private, what's the catch
- **[Troubleshooting](TROUBLESHOOTING.md)** — when something misbehaves
- **[Self-hosting](SELF_HOSTING.md)** — run blok on your own backend instead

Stuck on something this page should have covered? Say so in
[Discussions](https://github.com/pompei1i/blok/discussions) — that's a documentation bug and
worth reporting.
