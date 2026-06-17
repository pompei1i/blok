# Self-hosted TURN (coturn)

Replaces the 500 MB/mo Metered free trial with an unlimited relay on your own VPS.
Screen share / camera need a TURN relay when both peers are behind strict NAT —
this removes that quota; you only pay for the VPS bandwidth.

## 1. Get a VPS
Any cheap Linux box with a **public IP** works (Hetzner CX22, Contabo, etc. — ~€4/mo).
TURN is bandwidth-bound, not CPU-bound: one screen share at 8 Mbps relayed both
ways ≈ 2 GB/hour. A 20 TB/mo box is effectively unlimited for a small community.

## 2. Install Docker
```bash
curl -fsSL https://get.docker.com | sh
```

## 3. Configure
Copy this folder to the VPS, then edit `turnserver.conf`:
- `external-ip=` → the VPS **public IP**.
- `user=blokturn:CHANGE_ME_STRONG_PASSWORD` → pick a strong password.

## 4. Open the firewall
```bash
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp        # TLS (turns:)
ufw allow 49160:49200/udp # relay media range (must match turnserver.conf)
```
On a cloud provider, open the same ports in its security group too.

## 5. Run
```bash
docker compose up -d
docker compose logs -f   # check it started cleanly
```

## 6. Point the app at it
Update the **GitHub repo secrets** (Settings → Secrets → Actions), then cut a new
release so they're baked into the build:

| Secret | Value |
|---|---|
| `VITE_TURN_URLS` | `turn:YOUR_IP:3478,turn:YOUR_IP:3478?transport=tcp` (add `,turns:turn.yourdomain.com:5349?transport=tcp` if you set up TLS) |
| `VITE_TURN_USERNAME` | `blokturn` |
| `VITE_TURN_CREDENTIAL` | the password you set in `turnserver.conf` |

## 7. Verify
Test the relay before relying on it:
- https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/ —
  enter `turn:YOUR_IP:3478`, the username and password, **Add Server**, then
  **Gather candidates**. You should see candidates of type **`relay`**. No relay
  candidate = firewall/config issue.

## TLS (recommended for strict corporate/mobile networks)
1. Point a subdomain `turn.yourdomain.com` → VPS IP.
2. `certbot certonly --standalone -d turn.yourdomain.com`
3. Uncomment the `cert=`/`pkey=` lines in `turnserver.conf` and the cert volume
   in `docker-compose.yml`, then `docker compose up -d`.
4. Add `turns:turn.yourdomain.com:5349?transport=tcp` to `VITE_TURN_URLS`.

## Hardening note (later)
The credentials here are **static and baked into the client**, so anyone can
extract and abuse the relay (the `user-quota`/`total-quota` limits cap the blast
radius). For a public launch, upgrade to **time-limited HMAC credentials**: set
`use-auth-secret` + `static-auth-secret` in coturn and hand out short-lived creds
from a tiny server endpoint (e.g. a Supabase Edge Function) that the client fetches
on join. That keeps the secret off the client entirely.
