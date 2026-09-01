# blok user guide

Everything blok does, grouped by what you're trying to accomplish. If you haven't installed
it yet, start with [Getting started](GETTING_STARTED.md).

**Contents**

- [Messages](#messages) · [Polls](#polls) · [Search](#search)
- [Friends, DMs and calls](#friends-dms-and-calls)
- [Voice channels](#voice-channels)
- [Screen share and video](#screen-share-and-video)
- [b.ai.t, the assistant](#bait-the-assistant)
- [Reading other languages](#reading-other-languages)
- [Levels, quests and the store](#levels-quests-and-the-store)
- [Running a server](#running-a-server) · [Roles](#roles-and-permissions) · [Moderation](#moderation)
- [Making it yours](#making-it-yours)
- [Settings reference](#settings-reference)
- [Keyboard shortcuts](#keyboard-shortcuts)

---

## Messages

Type at the bottom, **`Enter`** to send, **`Shift` + `Enter`** for a new line.

Hover any message for its actions, or open the **⋯** menu for the rest:

| Action | Notes |
|---|---|
| **Reply** | Quotes the original above yours. If the original is later deleted, your reply says so rather than breaking. |
| **Add reaction** | Emoji picker with search. Click an existing reaction to join it. |
| **Edit** | Your own messages only. `Enter` saves, `Esc` cancels; the message is marked *(edited)*. |
| **Pin** | Pins it to the channel so anyone can find it later. |
| **Copy** | Plain text to the clipboard. |
| **Delete** | Yours always; other people's if you have the permission. |
| **Translate with b.ai.t** | One-off translation of a single message. |

**Mentions.** Type `@` and start typing a username. Mentioning someone notifies them.

**Attachments.** Drag files anywhere onto the chat, or use the attach button — images,
video, audio and documents. Images and video preview inline; video gets a real player.

**GIFs.** The GIF button searches Tenor. (In a self-hosted build this needs a Tenor API key
— without one the button is simply empty.)

**Announcements.** Posted through b.ai.t or the announcement action, these render as a
highlighted block rather than an ordinary message. Good for "read this" without pinning.

**Typing indicators** show while others are composing, and messages arrive live — no
refresh, ever.

**If a channel has slow mode on**, you'll see the remaining wait instead of the input box.
Same if a moderator has timed you out.

### Polls

Create a poll from the chat actions or by asking b.ai.t. You choose:

- The question and 2–10 options
- **Single choice** or **multiple choice**
- **Open votes** (everyone sees who voted for what) or **anonymous**

Results update live as people vote, with a running total.

### Search

Two different tools, worth keeping straight:

- **`Ctrl` + `F`** — search *inside the current channel*. Results are clickable and jump you
  to the message in place.
- **`Ctrl` + `K`** — jump *anywhere*: servers, channels and people at once. `↑` `↓` to move,
  `Enter` to go, `Esc` to close.

There's also a member search in the right-hand list and a channel search in the sidebar,
for when you know roughly where you're going.

## Friends, DMs and calls

Open the friends panel to send a request **by username**. They'll see it under *Pending* and
can accept or decline; you can cancel one you sent by mistake.

Once you're friends — or from any member's right-click menu — you can:

- **Message** them directly. DMs live outside servers entirely, with their own permissions.
- **Call** them. Voice by default; turn your camera on during the call for video.
- **Invite to Server**, which copies an invite code straight to your clipboard.

Incoming calls ring with **Accept** / **Decline**. Group chats get their own text channels
and voice rooms, and appear in the top bar under *Opened*.

## Voice channels

**Click a voice channel to join it.** There is no connect button and no confirmation.

While you're in one:

- **Mute** — `Ctrl` + `Shift` + `M`, or the microphone button bottom-left.
- **Deafen** — `Ctrl` + `Shift` + `D`. Silences everyone else *and* mutes you.
- **Push to talk** — enable it in **Settings → Hotkeys**, then hold **`Space`**. It's
  suppressed while you're typing, so it never fires mid-message.
- **Per-person volume** — right-click anyone in the channel to adjust their volume or mute
  them just for you. It doesn't affect what anyone else hears.
- **Leave** — the leave button in the bottom bar, or click the channel again.

Speaking users are outlined live, so you can see who's talking without listening for it.

**Under the hood**, audio is captured and mixed by a native Rust engine at 48 kHz with noise
suppression, echo cancellation and a noise gate, and travels **peer-to-peer** — your voice
goes to the other people in the channel, not through a server. A jitter buffer of roughly
150 ms absorbs network wobble. Tune the input side in **Settings → Audio**.

## Screen share and video

Both are **experimental**. They work, and they occasionally don't — that's what beta means.

**To share your screen**, use the screen button inside a voice channel. The picker lets you
choose:

- A whole **screen** or a single **window**
- **Frame rate** — up to 60 fps
- **Resolution** — including native
- **Quality** — low, medium, high
- **Share desktop audio** — send what your machine is playing along with the picture

While sharing you can swap the source without stopping, and viewers get **grid** or **focus**
layouts, fullscreen, and their own volume control for your desktop audio. You'll see a
persistent reminder that your screen is being shared.

**Camera** works in voice channels and in DM calls. Toggle it any time; **Settings → Video**
has preview, mirroring and quality. Video travels over the same peer-to-peer transport.

> Higher fps and resolution cost upload bandwidth. If viewers report a slideshow, drop to
> 30 fps or medium quality first — it helps more than lowering resolution.

## b.ai.t, the assistant

**b.ai.t** ("blok artificial intelligence toy") is in the top bar. It isn't a chatbot pinned
to the side of the app — it acts on the server for you, through real actions:

| Ask for | What it does |
|---|---|
| A server | Creates it, optionally with a whole set of categories and channels in one go |
| A channel or category | Creates it in the server you're in |
| A role | Creates it with a name and colour (permissions start empty — you assign those yourself) |
| A role for someone | Lists roles, then assigns or removes one by username |
| A poll | Builds it in the current channel, single or multiple choice, named or anonymous |
| An announcement | Posts it to the current channel |
| A summary | Reads the recent messages in the channel and gives you the gist |
| A timer | Sends a message to the channel after a delay you name |
| A server avatar | Generates one from a text seed |
| A translation | Translates text you give it |
| The member list | Tells you who's in the server |

The panel has **quick commands** for the common ones and keeps a **history** per server, so
"the thing we set up yesterday" is still there.

**During the beta there's a limit of 10 prompts per day** per account; the counter sits in
the top-right of the panel. The API key lives server-side in an Edge Function — it is never
in the app you downloaded.

## Reading other languages

Turn on **auto-translate** in **Settings → Language** and messages written in another
language arrive in yours — in every channel, DM and group chat, with no per-conversation
setup.

- Messages already in your language are left alone.
- A translated message is marked *translated from …*, with **show original** one click away.
- Translations are cached and shared: the first person to read a message pays for the
  translation, everyone else reads the stored one.

The app UI itself speaks **English, Russian, Ukrainian, Polish, German and Spanish** —
that's the **Language** setting too, and it's independent of the translation toggle.

## Levels, quests and the store

Talking earns **XP** and **coins**. Three quests reset daily:

| Quest | Reward |
|---|---|
| Send 5 messages | 50 XP · 50 coins |
| Send 15 messages | 100 XP · 100 coins |
| React to 5 messages | 75 XP · 75 coins |

There's a **200 coin per day cap** from quests, so clearing all three tops you out rather
than paying the full 225.

**The kube** is the loot box, in the **Store**. It costs **100 coins** and drops a random
cosmetic:

- Rarities are **Common · Rare · Epic · Legendary**.
- **Duplicates turn into dust** — 10 / 25 / 60 / 150 by rarity — and dust buys things
  directly in the shop.
- **Pity is two-tier**: an Epic or better is guaranteed by your 10th open without one, and a
  Legendary by your 90th. The counters show on the box.

Cosmetics are **nameplates** (your name's colour or gradient), **avatar frames** and
**banners**. Equip them from the Store's inventory tab or **Settings → Cosmetics**.

The roll happens in the database, not in the app — the odds and the pity counter aren't
something a modified client can lie about.

## Running a server

**Create one** from the top bar. As the owner you hold every permission permanently and you
can't be removed from your own server.

**Channels** are **text** or **voice**, and you can group them into **categories**.
Renaming, deleting and creating are all permission-gated for everyone but you.

**Invites** come in two shapes:

- **An invite code** — generate one, set it to expire in **1 day** or **7 days**, cap the
  number of uses, and share it. The panel shows uses so far and time left.
- **By username** — add someone directly, no code involved.

**Deleting a server** is permanent and takes its channels and messages with it. Only the
owner can do it, and it asks you to confirm by name.

### Roles and permissions

**Server settings → Roles.** A role is a name, a colour and a set of permissions:

| Group | Permissions |
|---|---|
| **General** | Invite Members · Rename Server · Manage Server Icon · Manage Server · Manage Roles |
| **Channels** | Create Channels · Delete Channels · Rename Channels · Manage Channels (slow mode) |
| **Moderation** | Timeout Members · Ban Members |

A live **preview** shows how a member with that role will look, and unsaved changes are
flagged before you navigate away. The **Members** tab assigns roles; **Bans** and
**Audit Log** live alongside.

Permission checks are enforced in the database, not in the app. A client that ignores the
UI still can't do anything its roles don't allow.

### Moderation

| Tool | Effect |
|---|---|
| **Timeout** | The member can't post for a set period; they see how long is left. Removable early. |
| **Kick** | Removes them from the server. They can rejoin with a new invite. |
| **Ban** | Removes them and blocks rejoining by invite. Optional reason. Reversible from the **Bans** tab. |
| **Slow mode** | A per-channel minimum gap between messages. |
| **Delete message** | Removes someone else's message. |

Every one of these is written to the **audit log** with who did it and when — bans, unbans,
timeouts, kicks and slow-mode changes.

## Making it yours

**Settings → Theme:**

- **Base theme** — dark, light, or custom
- **Chat background** — upload an image or paste a URL; it sits behind your messages
- **Custom CSS** — inject your own styles and restyle anything, applied on save

**Settings → View** covers **compact mode**, whether the **member list** shows, and **UI
scale** for when the default is too small or too large.

**Settings → Account** has your display name, avatar, **pronouns**, status message, theme
colour and bio.

## Settings reference

| Tab | What's in it |
|---|---|
| **Account** | Display name, username, email, avatar, pronouns, status, about me, theme colour, log out |
| **Security** | Change password (minimum 8 characters) |
| **Audio** | Microphone permission, input/output device, input volume, noise suppression, echo cancellation, noise gate |
| **Video** | Camera permission and device, preview, mirroring, camera quality; screen-share fps, resolution and quality |
| **Hotkeys** | Push-to-talk toggle and the shortcut reference |
| **View** | Compact mode, member list, UI scale |
| **Theme** | Base theme, chat background, custom CSS |
| **Language** | App language and the auto-translate toggle |
| **System** | Launch on startup (Windows), current version, check for and install updates |
| **Cosmetics** | Equip what you own |

Language, UI scale and a few others only take effect when you press **Apply**.

## Keyboard shortcuts

| Shortcut | Does |
|---|---|
| `Ctrl` + `K` | Jump to any server, channel or person |
| `Ctrl` + `F` | Search inside the current channel |
| `Ctrl` + `Shift` + `M` | Mute / unmute your microphone |
| `Ctrl` + `Shift` + `D` | Deafen / undeafen |
| `Space` (held) | Talk, when push-to-talk is on — ignored while typing |
| `Enter` | Send the message |
| `Shift` + `Enter` | New line without sending |
| `Enter` / `Esc` while editing | Save / cancel |
| `↑` `↓` then `Enter` | Move through search results and open one |
| `Esc` | Close whatever is open |

The mute and deafen shortcuts read the **physical** key, so they work the same on a
non-QWERTY layout.

---

Something here not match what you're seeing? That's worth an
[issue](https://github.com/pompei1i/blok/issues) — documentation drift is a bug.
