# Security Policy

blok handles messages, voice, and account data for real people. If you find a way to read,
write, or impersonate something you shouldn't, I want to know before anyone else does.

## Reporting a vulnerability

**Please don't open a public issue.**

Use GitHub's private reporting: **[Report a vulnerability](https://github.com/pompei1i/blok/security/advisories/new)**
(Security tab → Advisories → Report a vulnerability). It's private between you and the
maintainer until a fix ships.

Useful things to include:

- What an attacker can do, and what they need to start (an account? a server invite? nothing?)
- Steps to reproduce — a curl command or a short script beats prose
- The version or commit you tested
- Anything you already know about the fix

You'll get a first response within **72 hours**. This is a solo project without an on-call
rotation, so a fix lands as fast as it reasonably can; you'll be told where it stands rather
than left guessing.

## Scope

In scope — the code in this repository and the security model it defines:

- Row-Level Security holes: reading messages, servers, or profiles you aren't a member of
- Privilege escalation through the `SECURITY DEFINER` RPCs (economy, moderation, roles, invites)
- Anything that leaks a server-side secret (Anthropic/Gemini keys, Cloudflare TURN tokens) to a client
- Auth bypass, session fixation, or account takeover
- Remote code execution in the Tauri shell or the Rust audio/WebRTC layer
- Getting the auto-updater to install something not signed by the project's key

Out of scope:

- Anything requiring a stolen device, a malicious OS, or physical access
- Denial of service by brute traffic against a self-hosted Supabase project
- Missing hardening headers with no demonstrated impact
- Reports from automated scanners with no working proof of concept
- Social engineering of the maintainer or of users

Self-hosted deployments are yours to secure: your Supabase project, your secrets, your keys.
Bugs in *how blok tells you to configure them* are in scope — misconfigurations of your own
instance are not.

## Handling of secrets

No API key that must stay secret ships in the client binary. The Anthropic/Gemini keys and
the Cloudflare TURN token live as Supabase Edge Function secrets and are used server-side,
behind per-user rate limits. The Supabase anon key *is* in the client by design — it is
useless without a valid session, because every table is protected by RLS. If you find a
path where that assumption doesn't hold, that's exactly the kind of report this document
is asking for.

## Supported versions

Only the latest release gets fixes. blok is in public beta and updates ship through the
in-app auto-updater; run the current version before reporting.
