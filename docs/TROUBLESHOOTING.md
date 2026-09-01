# Troubleshooting

Fixes for the things that actually go wrong, in the order worth trying them. This page is
for **using** blok — if you're standing up your own backend, the
[self-hosting guide](SELF_HOSTING.md#troubleshooting) has its own table for schema and
Edge Function problems.

> **Two moves that fix a surprising amount:** restart the app, and check
> **Settings → System** to make sure you're on the current version. Do both before working
> through anything below.

---

## Installing and launching

**Windows warns about an unknown publisher.**
Expected — blok isn't signed with a paid Microsoft certificate. **More info → Run anyway**.
See the [FAQ](FAQ.md#is-the-windows-warning-normal) for why, and for what *is* verified.

**The AppImage won't start.**
Make it executable first: `chmod +x blok_*.AppImage`. If it still refuses, run it from a
terminal — the error it prints usually names a missing system library.

**Nothing happens when I launch it, or the window is blank.**
The window needs a system webview. On Windows that's WebView2, which Windows 10/11 normally
ships with; installing
[Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
fixes it if yours is missing. On Linux, install `libwebkit2gtk-4.1-0` from your package
manager.

**It says "no internet connection" but I'm online.**
A VPN, proxy, or corporate firewall is blocking the connection to the backend. Try without
the VPN to confirm, then allow the app through.

## Signing in

**"Password must be at least 6 characters" on a password that's longer.**
Check the *confirm* field too — a mismatch is reported separately, but it's easy to read
the wrong error.

**I never got the password reset email.**
Check spam. The code is emailed by the backend's mail provider, and free-tier providers are
rate-limited and occasionally slow — wait a few minutes before requesting another.

**I signed in and every list is empty.**
On the public beta this shouldn't happen — report it. On a self-hosted instance it almost
always means the database migrations weren't fully applied; see
[self-hosting troubleshooting](SELF_HOSTING.md#troubleshooting).

## Voice

Work down this list — it's ordered by how often each one is the culprit.

**Nobody can hear me.**

1. **Are you muted?** The microphone button bottom-left, or `Ctrl` + `Shift` + `M`. Also
   check you aren't **deafened** (`Ctrl` + `Shift` + `D`) — that mutes you too.
2. **Push-to-talk on without knowing it?** **Settings → Hotkeys**. If it's on, you have to
   hold `Space` to be heard.
3. **Microphone permission.** **Settings → Audio → Microphone Access**. If it says *access
   denied*, use **Open System Settings** — on Windows that's Privacy → Microphone, and both
   "Microphone access" and "Let desktop apps access your microphone" need to be on.
4. **Wrong input device.** Set **Input Device** explicitly instead of "System Default",
   especially with a headset plugged in alongside a webcam or built-in mic.
5. **Noise gate too aggressive.** **Settings → Audio → Noise Gate** — if it's high, quiet
   speech gets cut entirely. Turn it down or off and test again.

**I can't hear anyone.**

1. Not deafened? Output device correct in **Settings → Audio**?
2. **Did you mute them locally?** Right-click each person in the voice channel — a per-user
   mute or a volume slider at zero only affects you, and it's easy to forget.
3. Check your OS volume mixer; the app can be muted there independently.

**Voice connects but everyone is silent, both directions.**
This is the signature of a blocked peer-to-peer connection — audio goes directly between
participants, and some networks won't allow that. Corporate, campus and hotel Wi-Fi are the
usual offenders.

- Try a different network (a phone hotspot is a fast test).
- Try with a VPN on, or off if you already use one.
- If you're self-hosting, this is what TURN relays are for — check the `turn` function is
  deployed.

**My voice cuts in and out.**
Lower the noise gate, and turn **Noise Suppression** off briefly to see whether it's
clipping your speech. If it's only bad while someone shares a screen, that's bandwidth —
have them drop the frame rate.

**Echo — people hear themselves.**
**Echo Cancellation** on, in **Settings → Audio**. If it persists, the person with the echo
is on speakers rather than headphones; headphones end it immediately.

## Screen share and video

Screen share and camera are **experimental** — expect rough edges.

**Viewers see a black frame.**
Usually the same peer-to-peer blocking as silent voice, above. It can also be a GPU-capture
quirk on some hardware: try sharing a **single window** instead of the whole screen, or the
other way round.

**It's a slideshow.**
Frame rate and quality cost upload bandwidth. In **Settings → Video**, drop to 30 fps and
medium quality before touching resolution — it helps more.

**"Desktop audio unavailable".**
Desktop audio capture isn't available for that source or on that platform. The video keeps
working; only the audio share is unavailable.

**"Screen share requires the desktop app".**
You're not in the desktop build — screen capture is native and can't run in a browser
context.

**My camera isn't detected.**
**Settings → Video** — grant camera access, then pick the device explicitly. Close anything
else using the camera first; most systems only let one app hold it.

## Messages and files

**My message didn't send.**
If the channel has **slow mode**, you'll see the remaining wait. If a moderator has **timed
you out**, the input box says so. Otherwise check the connection indicator.

**An attachment won't upload.**
Very large files are the usual cause. Try a smaller one to confirm it's size rather than
the file itself.

**The GIF picker is empty.**
On a self-hosted build, GIF search needs a Tenor API key; without one the picker has nothing
to show.

**Someone's message shows as "original deleted message".**
Working as intended — they deleted a message your reply was quoting.

## b.ai.t and translation

**b.ai.t says the daily limit is reached.**
10 prompts per account per day during the beta, on a rolling 24-hour window. Wait it out.

**b.ai.t says it's coming soon.**
The assistant has been switched off deliberately in that build. Nothing to fix on your end.

**Auto-translation isn't translating anything.**
Check it's on in **Settings → Language**. Then check the messages actually *are* in another
language — anything blok reads as your own language is deliberately left alone. Very short
messages ("ok", "+1") are often unidentifiable and get skipped.

**"Translation limit reached".**
A per-user rate limit on the translation service. It resets; wait.

## Updates

**The update won't install.**
Updates are cryptographically verified before they run, and a failed signature check is a
refusal, not a bug. Try again later in **Settings → System** — and if it keeps failing,
download the installer manually from the
[releases page](https://github.com/pompei1i/blok-releases/releases/latest) and install over
the top. Your account and settings survive.

**I'm on an old version and it never prompts me.**
Check manually in **Settings → System**. A network that blocks the update feed will leave
you quietly stuck.

## Performance

**The app is heavy.**
Turn on **compact mode** and lower **UI scale** in **Settings → View**. Close screen shares
you're not watching — decoding video is the expensive part. If you set a **chat background**
image, a very large one costs memory.

**High CPU while in voice.**
Audio processing (noise suppression, echo cancellation) is real work. Turning off noise
suppression measurably reduces it, at the cost of a noisier mic.

## Still stuck?

Open a [Discussion](https://github.com/pompei1i/blok/discussions) or an
[issue](https://github.com/pompei1i/blok/issues) with:

- **Your version** — **Settings → System** shows it
- **Your OS**, and the distro if you're on Linux
- **What you did**, step by step, and what happened instead
- Whether it happens **every time**
- A screenshot or clip if it's visual

For anything security-related, don't post publicly — [SECURITY.md](../SECURITY.md) has the
private route.
