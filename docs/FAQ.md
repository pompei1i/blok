# FAQ

Honest answers to what people ask first. If your question is "why doesn't this work",
you want [Troubleshooting](TROUBLESHOOTING.md) instead.

## The basics

### What is blok?

A desktop chat app for communities — servers, channels, text, voice, video and screen
share — with an AI assistant that can actually build things for you and a small game
economy on top. If you've used Discord you'll be at home in about a minute.

The difference is underneath: blok has **no company in the middle**. The app talks straight
to a database, and voice and video go straight between the people in the call. The whole
thing is open source, so you can read exactly what it does, or run your own copy.

### Is it free?

Yes, and there's nothing to buy. No subscription, no paid tier, no cosmetics for money —
coins are earned by using the app and that's the only way to get them.

### Do I have to set up a server or a database?

No. Download the installer, make an account, you're in. That's the public beta.

Self-hosting is an *option*, not a requirement — it's there if you want the data on
infrastructure you control. That path is documented in [Self-hosting](SELF_HOSTING.md) and
takes about half an hour.

### What platforms does it run on?

**Windows 10/11** and **Linux** (`.deb`, `.rpm`, `.AppImage`). No macOS build yet — it's on
the roadmap, unscheduled. There's no browser version and no mobile app; a mobile companion
is a "someday, maybe".

### How finished is it?

It's a **public beta**, and the label is meant literally:

- **Text chat, servers, roles, moderation, the economy** — stable, in daily use.
- **Voice** — stable.
- **Screen share and video** — experimental. Usually fine, occasionally not.
- **b.ai.t** — works, capped at 10 prompts per day per account during the beta.

It's also a **solo project**. Bugs get fixed as fast as one person can fix them, and there's
no support rotation behind it.

## Privacy and safety

### Who can read my messages?

Whoever is in the channel — plus whoever runs the backend, which for the public beta is the
project maintainer, and for a self-hosted instance is whoever set it up.

Messages are **not end-to-end encrypted.** They're protected in transit by TLS and at rest
by database access rules that stop other *users* reading what they shouldn't, but someone
with database access can read them. If you need end-to-end encryption, use a messenger
built for that — blok isn't one, and saying otherwise would be a lie.

### Is voice private?

Voice and video never touch a server — they go **directly between participants**. That's
better than the usual arrangement for privacy: no one in the middle has the audio at all.

The trade-off worth knowing: in a direct connection, **the people you're talking to can
potentially see your IP address**, the same as in any peer-to-peer call. When a direct
connection can't be established, traffic falls back to a relay, which hides your address
from other participants but shows it to the relay instead. If that matters to you, use a
VPN.

### Is b.ai.t reading my chats?

Only what you point it at. When you ask it to summarise a channel it reads that channel's
recent messages to answer; otherwise it sees your prompt and nothing else. Auto-translation
sends message *ids*, not text — the server looks the message up under your own permissions,
so it can't be used to reach anything you couldn't already read.

Both run through Google's Gemini API, so those requests reach Google. The API key stays
server-side and is never in the app you downloaded.

### Is the Windows warning normal?

Yes. Windows SmartScreen flags installers from publishers it doesn't recognise, and blok
isn't signed with a paid Microsoft code-signing certificate. Choose **More info → Run
anyway**.

If you'd rather verify than trust: download only from the
[releases page](https://github.com/pompei1i/blok-releases/releases/latest), and note that
**updates** are held to a stricter standard than the first install — the auto-updater
verifies a cryptographic signature against a key built into the app and refuses anything
that doesn't match.

### What happens to my account if the project stops?

Your data lives in the backend you're using. For the public beta, that's the maintainer's —
so treat a beta account as impermanent. If that's not acceptable for your community,
self-host: then the project disappearing means you keep running the copy you have.

## Using it

### How do I invite people?

Generate an invite code in the server's invite panel — pick an expiry (1 or 7 days) and a
maximum number of uses — and send it. They paste it into **Join by Code**. If you already
know their username, **Add Member** skips codes entirely.

### Can I move a Discord server over?

No. There's no importer for servers, messages or members.

### How big a community can it handle?

The public beta is sized for small ones — friends, a team, a club. Voice is peer-to-peer,
which means every participant sends their audio to every other participant, so voice
channels get expensive for the *participants* well before the server notices. Large voice
rooms are not what this architecture is good at.

Self-hosted, your ceiling is whatever your Supabase plan is.

### Why is my b.ai.t counter at 0?

10 prompts per account per day during the beta; it resets on a rolling 24-hour window. The
limit exists because the AI costs real money and one person is paying it.

### Can I change how it looks?

A lot. Light/dark/custom themes, a chat background image, UI scale, compact mode — and
**custom CSS**, which lets you restyle essentially anything. See
[Making it yours](USER_GUIDE.md#making-it-yours).

## The project

### Who makes this?

One person. It started as "a Discord I actually control" and kept growing.

### What does the AGPL license mean for me?

As a **user**: nothing to worry about. Use it, free, for anything.

As someone who **modifies it and runs it for other people**: you have to offer those people
your source code. That's the whole point of the license — a forked, hosted blok has to stay
as open as this one.

As someone who just **reads or self-hosts it privately**: also nothing to worry about.

### Can I contribute?

Yes, and small sharp contributions are the most useful kind: a bug report with real repro
steps, a translation fix that reads like a human wrote it, a test. Open an issue before a
large feature — see [CONTRIBUTING.md](../CONTRIBUTING.md).

### I found a security hole.

Please don't post it publicly. [SECURITY.md](../SECURITY.md) has the private reporting
route; you'll get a first response within 72 hours.

### Where do I ask something not answered here?

[Discussions](https://github.com/pompei1i/blok/discussions) for questions,
[Issues](https://github.com/pompei1i/blok/issues) for bugs.
