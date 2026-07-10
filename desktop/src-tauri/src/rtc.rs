//! Native P2P transport: webrtc-rs peer connections carrying data channels only.
//!
//! Why this exists: Ubuntu/Mint's system WebKitGTK is compiled WITHOUT WebRTC
//! (`RTCPeerConnection` is undefined no matter what settings are enabled), so
//! browser-side P2P can never work on Linux. This module owns the peer
//! connections natively; the exact same code path runs on Windows, making the
//! transport universal. Payloads are our own: raw i16-LE PCM for voice (mixed
//! by `audio.rs`), JPEG frames for screen-share/camera video. Signaling stays
//! in JS (Supabase broadcast) — SDP/ICE strings just pass through commands and
//! the event channel.
//!
//! Channel layout per peer:
//!   "audio" — unordered, max_retransmits: 0 (a lost voice frame is worthless).
//!   "video" — unordered, reliable (a JPEG frame is 30–200KB and fragments into
//!             many SCTP chunks; with retransmits off a single lost chunk would
//!             kill the whole frame). Staleness is handled by a seq header on
//!             the receiver, latency by a drop-oldest send queue on the sender.
//!
//! Wire framing (peer → peer):
//!   audio DC: [u8 tag (1=mic, 2=desktop-audio)][u32-LE rate][i16-LE pcm...]
//!   video DC (per fragment — SCTP rejects messages above the negotiated
//!   max-message-size (~64KB), so JPEG frames are app-fragmented and
//!   reassembled on the receiver; the channel is reliable so all parts arrive):
//!     [u8 tag (1=screen, 2=camera)][u32-LE seq][u16-LE part][u16-LE parts]
//!     [u32-LE w][u32-LE h][chunk...]
//!
//! rtc_events framing (Rust → JS, first byte = event type):
//!   0x01 signal-out:  [u8 kind (1=offer,2=answer,3=ice)][u16-LE id_len][peer_id][payload utf8]
//!   0x02 conn-state:  [u8 state][u16-LE id_len][peer_id]
//!                     (state: 0=connecting,1=connected,2=disconnected,3=failed,4=closed)
//!   0x03 video frame: [u8 tag][u16-LE id_len][peer_id][u32-LE seq][u32-LE w][u32-LE h][jpeg]
//!   0x04 speaking:    [u8 speaking (0|1)][u16-LE id_len][peer_id]

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::mpsc;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::data_channel::data_channel_init::RTCDataChannelInit;
use webrtc::data_channel::RTCDataChannel;
use webrtc::ice_transport::ice_candidate::{RTCIceCandidate, RTCIceCandidateInit};
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;

use crate::audio;

// ── public handle (managed state) ─────────────────────────────────────────────

pub struct RtcState(pub Mutex<Option<RtcHandle>>);

/// The currently active rtc session, reachable from code that lives outside
/// Tauri command context (the cpal capture callback, the screen-capture encode
/// thread). Set by `start()`; a dead runtime just ignores sends.
static ACTIVE: Mutex<Option<RtcHandle>> = Mutex::new(None);

/// Fan a mic PCM frame out to all connected peers (no-op without a session).
pub fn broadcast_mic(rate: u32, pcm_le: Vec<u8>) {
    if let Some(h) = ACTIVE.lock().unwrap().as_ref() {
        h.broadcast_audio(1, rate, pcm_le);
    }
}

/// Fan a desktop-audio PCM frame out to all connected peers (screen share).
pub fn broadcast_desktop_audio(rate: u32, pcm_le: Vec<u8>) {
    if let Some(h) = ACTIVE.lock().unwrap().as_ref() {
        h.broadcast_audio(2, rate, pcm_le);
    }
}

/// Fan a JPEG video frame out to all connected peers (screen share / camera).
pub fn broadcast_video_frame(tag: u8, w: u32, h: u32, jpeg: Vec<u8>) {
    if let Some(hd) = ACTIVE.lock().unwrap().as_ref() {
        hd.broadcast_video(tag, w, h, jpeg);
    }
}

/// Cheap-to-clone handle into the rtc runtime. Held in Tauri managed state and
/// by the audio-capture fan-out.
#[derive(Clone)]
pub struct RtcHandle {
    cmd_tx: mpsc::UnboundedSender<RtcCmd>,
}

impl RtcHandle {
    fn send(&self, cmd: RtcCmd) {
        let _ = self.cmd_tx.send(cmd);
    }

    /// Broadcast a mic/desktop PCM frame to every connected peer's audio channel.
    /// Called from the cpal capture callback — must never block.
    pub fn broadcast_audio(&self, tag: u8, rate: u32, pcm_le: Vec<u8>) {
        self.send(RtcCmd::BroadcastAudio { tag, rate, pcm_le });
    }

    /// Broadcast a JPEG video frame (screen or camera) to every connected peer.
    pub fn broadcast_video(&self, tag: u8, w: u32, h: u32, jpeg: Vec<u8>) {
        self.send(RtcCmd::BroadcastVideo { tag, w, h, jpeg });
    }

    pub fn set_ice_servers_json(&self, json: &str) -> Result<(), String> {
        let servers = parse_ice_servers(json)?;
        self.send(RtcCmd::SetIceServers(servers));
        Ok(())
    }

    pub fn create_peer(&self, peer_id: String, initiator: bool) {
        self.send(RtcCmd::CreatePeer { peer_id, initiator });
    }

    pub fn signal_remote(&self, peer_id: String, kind: String, payload: String) {
        self.send(RtcCmd::SignalRemote { peer_id, kind, payload });
    }

    pub fn close_peer(&self, peer_id: String) {
        self.send(RtcCmd::ClosePeer { peer_id });
    }

    pub fn close_all(&self) {
        self.send(RtcCmd::CloseAll);
    }

    pub fn set_user_volume(&self, peer_id: String, volume: f32) {
        self.send(RtcCmd::SetUserVolume { peer_id, volume });
    }
}

/// Parse the JS-side `RTCIceServer[]` JSON (same shape the browser used:
/// `[{urls: string|string[], username?, credential?}]`).
fn parse_ice_servers(json: &str) -> Result<Vec<RTCIceServer>, String> {
    #[derive(serde::Deserialize)]
    #[serde(untagged)]
    enum Urls {
        One(String),
        Many(Vec<String>),
    }
    #[derive(serde::Deserialize)]
    struct JsServer {
        urls: Urls,
        username: Option<String>,
        credential: Option<String>,
    }
    let servers: Vec<JsServer> = serde_json::from_str(json).map_err(|e| e.to_string())?;
    Ok(servers
        .into_iter()
        .map(|s| RTCIceServer {
            urls: match s.urls {
                Urls::One(u) => vec![u],
                Urls::Many(v) => v,
            },
            username: s.username.unwrap_or_default(),
            credential: s.credential.unwrap_or_default(),
        })
        .collect())
}

// ── TURN probe (settings-tab connection test) ─────────────────────────────────

#[derive(serde::Serialize)]
pub struct TurnProbe {
    pub relay_reachable: bool,
    pub candidate_types: Vec<String>,
}

/// Gather ICE candidates against the given servers and report whether a relay
/// (TURN) candidate showed up. Runs on Tauri's own async runtime — fully
/// isolated from the transport runtime.
pub async fn test_turn(ice_servers_json: String) -> Result<TurnProbe, String> {
    let servers = parse_ice_servers(&ice_servers_json)?;
    let api = build_api().await.map_err(|e| e.to_string())?;
    let pc = Arc::new(
        api.new_peer_connection(RTCConfiguration {
            ice_servers: servers,
            ..Default::default()
        })
        .await
        .map_err(|e| e.to_string())?,
    );

    let types = Arc::new(Mutex::new(Vec::<String>::new()));
    let relay_found = Arc::new(tokio::sync::Notify::new());
    {
        let types = types.clone();
        let relay_found = relay_found.clone();
        pc.on_ice_candidate(Box::new(move |c: Option<RTCIceCandidate>| {
            let types = types.clone();
            let relay_found = relay_found.clone();
            Box::pin(async move {
                if let Some(c) = c {
                    use webrtc::ice_transport::ice_candidate_type::RTCIceCandidateType as T;
                    let name = match c.typ {
                        T::Host => "host",
                        T::Srflx => "srflx",
                        T::Prflx => "prflx",
                        T::Relay => "relay",
                        T::Unspecified => "unspecified",
                    };
                    let mut g = types.lock().unwrap();
                    if !g.iter().any(|x| x == name) {
                        g.push(name.to_string());
                    }
                    if c.typ == T::Relay {
                        relay_found.notify_one();
                    }
                }
            })
        }));
    }

    // A data channel makes the PC actually gather.
    let _dc = pc
        .create_data_channel("probe", None)
        .await
        .map_err(|e| e.to_string())?;
    let offer = pc.create_offer(None).await.map_err(|e| e.to_string())?;
    pc.set_local_description(offer).await.map_err(|e| e.to_string())?;

    let relay_reachable =
        tokio::time::timeout(std::time::Duration::from_secs(10), relay_found.notified())
            .await
            .is_ok();
    let candidate_types = types.lock().unwrap().clone();
    let _ = pc.close().await;
    Ok(TurnProbe { relay_reachable, candidate_types })
}

enum RtcCmd {
    SetIceServers(Vec<RTCIceServer>),
    CreatePeer { peer_id: String, initiator: bool },
    SignalRemote { peer_id: String, kind: String, payload: String },
    ClosePeer { peer_id: String },
    CloseAll,
    SetUserVolume { peer_id: String, volume: f32 },
    BroadcastAudio { tag: u8, rate: u32, pcm_le: Vec<u8> },
    BroadcastVideo { tag: u8, w: u32, h: u32, jpeg: Vec<u8> },
}

// ── event emission helpers ─────────────────────────────────────────────────────

#[derive(Clone)]
struct EventSink(Arc<Channel<InvokeResponseBody>>);

impl EventSink {
    fn emit(&self, bytes: Vec<u8>) {
        let _ = self.0.send(InvokeResponseBody::Raw(bytes));
    }

    fn signal_out(&self, peer_id: &str, kind: u8, payload: &str) {
        let id = peer_id.as_bytes();
        let mut b = Vec::with_capacity(4 + id.len() + payload.len());
        b.push(0x01);
        b.push(kind);
        b.extend_from_slice(&(id.len() as u16).to_le_bytes());
        b.extend_from_slice(id);
        b.extend_from_slice(payload.as_bytes());
        self.emit(b);
    }

    fn conn_state(&self, peer_id: &str, state: u8) {
        let id = peer_id.as_bytes();
        let mut b = Vec::with_capacity(4 + id.len());
        b.push(0x02);
        b.push(state);
        b.extend_from_slice(&(id.len() as u16).to_le_bytes());
        b.extend_from_slice(id);
        self.emit(b);
    }

    fn video_frame(&self, peer_id: &str, tag: u8, seq: u32, w: u32, h: u32, jpeg: &[u8]) {
        let id = peer_id.as_bytes();
        let mut b = Vec::with_capacity(16 + id.len() + jpeg.len());
        b.push(0x03);
        b.push(tag);
        b.extend_from_slice(&(id.len() as u16).to_le_bytes());
        b.extend_from_slice(id);
        b.extend_from_slice(&seq.to_le_bytes());
        b.extend_from_slice(&w.to_le_bytes());
        b.extend_from_slice(&h.to_le_bytes());
        b.extend_from_slice(jpeg);
        self.emit(b);
    }

    fn speaking(&self, peer_id: &str, speaking: bool) {
        let id = peer_id.as_bytes();
        let mut b = Vec::with_capacity(4 + id.len());
        b.push(0x04);
        b.push(speaking as u8);
        b.extend_from_slice(&(id.len() as u16).to_le_bytes());
        b.extend_from_slice(id);
        self.emit(b);
    }
}

// ── shared per-peer audio ingest state ────────────────────────────────────────

/// State the audio-DC message handlers need, shared across peers: per-user
/// volume overrides and the speaking debounce.
struct IngestShared {
    volumes: Mutex<HashMap<String, f32>>,
    /// peer_id → (last speaking flag, last time speech was detected)
    speaking: Mutex<HashMap<String, (bool, std::time::Instant)>>,
}

impl IngestShared {
    /// Handle one inbound audio-DC message: parse, compute speaking transitions,
    /// apply volume, feed the native mixer. Runs on the rtc runtime.
    fn ingest(&self, sink: &EventSink, peer_id: &str, data: &[u8]) {
        if data.len() < 5 {
            return;
        }
        let tag = data[0];
        let rate = u32::from_le_bytes([data[1], data[2], data[3], data[4]]);
        let pcm = &data[5..];
        let samples: Vec<i16> = pcm
            .chunks_exact(2)
            .map(|c| i16::from_le_bytes([c[0], c[1]]))
            .collect();
        if samples.is_empty() {
            return;
        }

        // Mixer key: desktop-audio during a screen share mixes as a phantom
        // extra participant so per-source cleanup stays trivial.
        let mix_key = if tag == 2 { format!("{peer_id}:screen") } else { peer_id.to_string() };

        // Speaking indicator (mic only), debounced: emit only on transitions,
        // with a 300ms hangover before reporting silence.
        if tag == 1 {
            let now = std::time::Instant::now();
            let loud = audio::is_speaking_i16(&samples);
            let mut map = self.speaking.lock().unwrap();
            let entry = map.entry(peer_id.to_string()).or_insert((false, now - std::time::Duration::from_secs(1)));
            if loud {
                entry.1 = now;
                if !entry.0 {
                    entry.0 = true;
                    sink.speaking(peer_id, true);
                }
            } else if entry.0 && now.duration_since(entry.1) > std::time::Duration::from_millis(300) {
                entry.0 = false;
                sink.speaking(peer_id, false);
            }
        }

        let volume = *self.volumes.lock().unwrap().get(peer_id).unwrap_or(&1.0);
        let mut f32s = audio::resample_to_f32(&samples, rate);
        if (volume - 1.0).abs() > f32::EPSILON {
            for s in f32s.iter_mut() {
                *s = (*s * volume).clamp(-1.0, 1.0);
            }
        }
        audio::mixer_add_samples(mix_key, f32s);
    }
}

// ── peer bookkeeping ──────────────────────────────────────────────────────────

struct Peer {
    pc: Arc<RTCPeerConnection>,
    /// Shared slots: filled immediately by the initiator, or by the responder's
    /// on_data_channel callback whenever the remote's channels arrive.
    audio_dc: Arc<Mutex<Option<Arc<RTCDataChannel>>>>,
    /// Bounded fan-out queue for video: a slow peer drops its own frames
    /// (newest kept) instead of backing up the capture pipeline.
    video_tx: Arc<Mutex<Option<mpsc::Sender<Vec<Vec<u8>>>>>>,
    pending_ice: Vec<RTCIceCandidateInit>,
    remote_set: bool,
}

const CONN_STATES: [(RTCPeerConnectionState, u8); 5] = [
    (RTCPeerConnectionState::Connecting, 0),
    (RTCPeerConnectionState::Connected, 1),
    (RTCPeerConnectionState::Disconnected, 2),
    (RTCPeerConnectionState::Failed, 3),
    (RTCPeerConnectionState::Closed, 4),
];

fn conn_state_code(s: RTCPeerConnectionState) -> Option<u8> {
    CONN_STATES.iter().find(|(v, _)| *v == s).map(|(_, c)| *c)
}

// ── runtime entry ─────────────────────────────────────────────────────────────

/// Start (or restart) the rtc runtime, wiring events to `on_event`. Returns the
/// handle to store in managed state. A fresh call tears down the previous
/// runtime's peers implicitly (JS reconnects them via signaling).
pub fn start(on_event: Channel<InvokeResponseBody>) -> RtcHandle {
    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<RtcCmd>();
    let handle = RtcHandle { cmd_tx };
    *ACTIVE.lock().unwrap() = Some(handle.clone());
    let sink = EventSink(Arc::new(on_event));

    std::thread::Builder::new()
        .name("blok-rtc".into())
        .spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    eprintln!("[rtc] failed to build tokio runtime: {e}");
                    return;
                }
            };

            rt.block_on(async move {
                let mut ice_servers: Vec<RTCIceServer> = Vec::new();
                let mut peers: HashMap<String, Arc<tokio::sync::Mutex<Peer>>> = HashMap::new();
                let ingest = Arc::new(IngestShared {
                    volumes: Mutex::new(HashMap::new()),
                    speaking: Mutex::new(HashMap::new()),
                });
                let video_seq = Arc::new(AtomicU32::new(0));

                while let Some(cmd) = cmd_rx.recv().await {
                    match cmd {
                        RtcCmd::SetIceServers(servers) => ice_servers = servers,

                        RtcCmd::CreatePeer { peer_id, initiator } => {
                            // Replace any stale peer with this id.
                            if let Some(old) = peers.remove(&peer_id) {
                                let old = old.lock().await;
                                let _ = old.pc.close().await;
                                audio::mixer_remove_peer(&peer_id);
                                audio::mixer_remove_peer(&format!("{peer_id}:screen"));
                            }
                            match new_peer(&peer_id, initiator, &ice_servers, &sink, &ingest).await {
                                Ok(peer) => {
                                    peers.insert(peer_id, Arc::new(tokio::sync::Mutex::new(peer)));
                                }
                                Err(e) => eprintln!("[rtc] create_peer({peer_id}) failed: {e}"),
                            }
                        }

                        RtcCmd::SignalRemote { peer_id, kind, payload } => {
                            let Some(peer) = peers.get(&peer_id).cloned() else { continue };
                            let sink = sink.clone();
                            tokio::spawn(async move {
                                let mut p = peer.lock().await;
                                if let Err(e) = apply_signal(&mut p, &peer_id, &kind, &payload, &sink).await {
                                    eprintln!("[rtc] signal {kind} from {peer_id} failed: {e}");
                                }
                            });
                        }

                        RtcCmd::ClosePeer { peer_id } => {
                            if let Some(peer) = peers.remove(&peer_id) {
                                let p = peer.lock().await;
                                let _ = p.pc.close().await;
                            }
                            audio::mixer_remove_peer(&peer_id);
                            audio::mixer_remove_peer(&format!("{peer_id}:screen"));
                        }

                        RtcCmd::CloseAll => {
                            for (peer_id, peer) in peers.drain() {
                                let p = peer.lock().await;
                                let _ = p.pc.close().await;
                                audio::mixer_remove_peer(&peer_id);
                                audio::mixer_remove_peer(&format!("{peer_id}:screen"));
                            }
                        }

                        RtcCmd::SetUserVolume { peer_id, volume } => {
                            ingest.volumes.lock().unwrap().insert(peer_id, volume.clamp(0.0, 2.0));
                        }

                        RtcCmd::BroadcastAudio { tag, rate, pcm_le } => {
                            let mut msg = Vec::with_capacity(5 + pcm_le.len());
                            msg.push(tag);
                            msg.extend_from_slice(&rate.to_le_bytes());
                            msg.extend_from_slice(&pcm_le);
                            let msg = bytes::Bytes::from(msg);
                            for peer in peers.values() {
                                let peer = peer.clone();
                                let msg = msg.clone();
                                tokio::spawn(async move {
                                    let dc = {
                                        let p = peer.lock().await;
                                        let slot = p.audio_dc.lock().unwrap();
                                        slot.clone()
                                    };
                                    if let Some(dc) = dc {
                                        if dc.ready_state()
                                            == webrtc::data_channel::data_channel_state::RTCDataChannelState::Open
                                        {
                                            let _ = dc.send(&msg).await;
                                        }
                                    }
                                });
                            }
                        }

                        RtcCmd::BroadcastVideo { tag, w, h, jpeg } => {
                            let seq = video_seq.fetch_add(1, Ordering::Relaxed);
                            let parts = fragment_video(tag, seq, w, h, &jpeg);
                            for peer in peers.values() {
                                let p = peer.try_lock();
                                let Ok(p) = p else { continue };
                                let tx = p.video_tx.lock().unwrap().clone();
                                if let Some(tx) = tx {
                                    // Bounded queue (in whole frames): when full the
                                    // frame is dropped for this peer — newest data wins
                                    // and a slow receiver can't back up the pipeline.
                                    let _ = tx.try_send(parts.clone());
                                }
                            }
                        }
                    }
                }
            });
        })
        .expect("failed to spawn blok-rtc thread");

    handle
}

// ── peer construction ─────────────────────────────────────────────────────────

async fn build_api() -> Result<webrtc::api::API, webrtc::Error> {
    let mut media = MediaEngine::default();
    let registry = register_default_interceptors(Registry::new(), &mut media)?;
    Ok(APIBuilder::new()
        .with_media_engine(media)
        .with_interceptor_registry(registry)
        .build())
}

async fn new_peer(
    peer_id: &str,
    initiator: bool,
    ice_servers: &[RTCIceServer],
    sink: &EventSink,
    ingest: &Arc<IngestShared>,
) -> Result<Peer, webrtc::Error> {
    let api = build_api().await?;
    let config = RTCConfiguration {
        ice_servers: ice_servers.to_vec(),
        ..Default::default()
    };
    let pc = Arc::new(api.new_peer_connection(config).await?);

    // Outbound ICE → JS → Supabase.
    {
        let sink = sink.clone();
        let pid = peer_id.to_string();
        pc.on_ice_candidate(Box::new(move |c: Option<RTCIceCandidate>| {
            let sink = sink.clone();
            let pid = pid.clone();
            Box::pin(async move {
                if let Some(c) = c {
                    if let Ok(json) = c.to_json() {
                        if let Ok(payload) = serde_json::to_string(&json) {
                            sink.signal_out(&pid, 3, &payload);
                        }
                    }
                }
            })
        }));
    }

    // Connection state → JS (UI indicators, rebuild logic).
    {
        let sink = sink.clone();
        let pid = peer_id.to_string();
        pc.on_peer_connection_state_change(Box::new(move |s: RTCPeerConnectionState| {
            let sink = sink.clone();
            let pid = pid.clone();
            Box::pin(async move {
                if let Some(code) = conn_state_code(s) {
                    sink.conn_state(&pid, code);
                }
            })
        }));
    }

    let peer = Peer {
        pc: pc.clone(),
        audio_dc: Arc::new(Mutex::new(None)),
        video_tx: Arc::new(Mutex::new(None)),
        pending_ice: Vec::new(),
        remote_set: false,
    };

    if initiator {
        // Initiator declares both channels; the responder receives them via
        // on_data_channel (negotiated in-band, standard WebRTC flow).
        let audio_dc = pc
            .create_data_channel(
                "audio",
                Some(RTCDataChannelInit {
                    ordered: Some(false),
                    max_retransmits: Some(0),
                    ..Default::default()
                }),
            )
            .await?;
        let video_dc = pc
            .create_data_channel(
                "video",
                Some(RTCDataChannelInit {
                    ordered: Some(false),
                    ..Default::default()
                }),
            )
            .await?;
        wire_audio_dc(&audio_dc, peer_id, sink, ingest);
        *peer.audio_dc.lock().unwrap() = Some(audio_dc);
        *peer.video_tx.lock().unwrap() =
            Some(spawn_video_sender(video_dc, sink.clone(), peer_id.to_string()));

        let offer = pc.create_offer(None).await?;
        pc.set_local_description(offer.clone()).await?;
        sink.signal_out(peer_id, 1, &offer.sdp);
    } else {
        // Responder side: adopt channels as they arrive from the remote.
        let sink2 = sink.clone();
        let ingest2 = ingest.clone();
        let pid = peer_id.to_string();
        let audio_slot = peer.audio_dc.clone();
        let video_slot = peer.video_tx.clone();
        pc.on_data_channel(Box::new(move |dc: Arc<RTCDataChannel>| {
            let sink = sink2.clone();
            let ingest = ingest2.clone();
            let pid = pid.clone();
            let audio_slot = audio_slot.clone();
            let video_slot = video_slot.clone();
            Box::pin(async move {
                match dc.label() {
                    "audio" => {
                        wire_audio_dc(&dc, &pid, &sink, &ingest);
                        *audio_slot.lock().unwrap() = Some(dc);
                    }
                    "video" => {
                        *video_slot.lock().unwrap() =
                            Some(spawn_video_sender(dc, sink.clone(), pid.clone()));
                    }
                    _ => {}
                }
            })
        }));
    }

    Ok(peer)
}

/// Attach the inbound-audio handler (and speaking bookkeeping) to an audio DC.
fn wire_audio_dc(
    dc: &Arc<RTCDataChannel>,
    peer_id: &str,
    sink: &EventSink,
    ingest: &Arc<IngestShared>,
) {
    let pid = peer_id.to_string();
    let sink = sink.clone();
    let ingest = ingest.clone();
    dc.on_message(Box::new(move |msg| {
        let pid = pid.clone();
        let sink = sink.clone();
        let ingest = ingest.clone();
        Box::pin(async move {
            ingest.ingest(&sink, &pid, &msg.data);
        })
    }));
}

/// Max payload bytes per video fragment. SCTP rejects messages above the
/// negotiated max-message-size (~64KB; confirmed empirically by the spike test's
/// ErrOutboundPacketTooLarge on 200KB sends), so frames are split app-side.
const VIDEO_FRAG_SIZE: usize = 48 * 1024;
const VIDEO_HDR: usize = 17; // tag(1) + seq(4) + part(2) + parts(2) + w(4) + h(4)

/// Split one JPEG frame into wire fragments (see module docs for the layout).
fn fragment_video(tag: u8, seq: u32, w: u32, h: u32, jpeg: &[u8]) -> Vec<Vec<u8>> {
    let parts = jpeg.chunks(VIDEO_FRAG_SIZE).count().max(1) as u16;
    jpeg.chunks(VIDEO_FRAG_SIZE)
        .enumerate()
        .map(|(i, chunk)| {
            let mut b = Vec::with_capacity(VIDEO_HDR + chunk.len());
            b.push(tag);
            b.extend_from_slice(&seq.to_le_bytes());
            b.extend_from_slice(&(i as u16).to_le_bytes());
            b.extend_from_slice(&parts.to_le_bytes());
            b.extend_from_slice(&w.to_le_bytes());
            b.extend_from_slice(&h.to_le_bytes());
            b.extend_from_slice(chunk);
            b
        })
        .collect()
}

/// Reassembles fragmented video frames per (tag): the channel is reliable, so
/// every part arrives, but it's unordered, so parts and even whole frames can
/// interleave. Stale frames (seq older than the newest delivered) are dropped.
struct VideoReassembler {
    /// (tag, seq) → (w, h, parts_total, received_count, buffers)
    pending: HashMap<(u8, u32), (u32, u32, u16, u16, Vec<Option<Vec<u8>>>)>,
    /// tag → newest seq already delivered
    delivered: HashMap<u8, u32>,
}

impl VideoReassembler {
    fn new() -> Self {
        Self { pending: HashMap::new(), delivered: HashMap::new() }
    }

    /// Feed one wire fragment; returns a complete frame when done.
    fn push(&mut self, d: &[u8]) -> Option<(u8, u32, u32, u32, Vec<u8>)> {
        if d.len() <= VIDEO_HDR {
            return None;
        }
        let tag = d[0];
        let seq = u32::from_le_bytes([d[1], d[2], d[3], d[4]]);
        let part = u16::from_le_bytes([d[5], d[6]]) as usize;
        let parts = u16::from_le_bytes([d[7], d[8]]);
        let w = u32::from_le_bytes([d[9], d[10], d[11], d[12]]);
        let h = u32::from_le_bytes([d[13], d[14], d[15], d[16]]);
        if parts == 0 || part >= parts as usize {
            return None;
        }
        // Stale? A newer frame for this tag already went out.
        if let Some(&newest) = self.delivered.get(&tag) {
            if seq <= newest && newest.wrapping_sub(seq) < u32::MAX / 2 {
                self.pending.remove(&(tag, seq));
                return None;
            }
        }

        let entry = self
            .pending
            .entry((tag, seq))
            .or_insert_with(|| (w, h, parts, 0, vec![None; parts as usize]));
        if entry.4[part].is_none() {
            entry.4[part] = Some(d[VIDEO_HDR..].to_vec());
            entry.3 += 1;
        }
        if entry.3 == entry.2 {
            let (w, h, _, _, buffers) = self.pending.remove(&(tag, seq)).unwrap();
            self.delivered.insert(tag, seq);
            // Drop any older half-assembled frames for this tag.
            self.pending.retain(|(t, s), _| *t != tag || *s > seq);
            let mut jpeg = Vec::new();
            for b in buffers {
                jpeg.extend_from_slice(&b?);
            }
            return Some((tag, seq, w, h, jpeg));
        }
        None
    }
}

/// Per-peer bounded video sender: consumes whole frames (as fragment lists) and
/// writes them to the DC, skipping when the SCTP buffer is deep (slow-receiver
/// protection). Also wires the inbound reassembler (transport is symmetric).
fn spawn_video_sender(
    dc: Arc<RTCDataChannel>,
    sink: EventSink,
    peer_id: String,
) -> mpsc::Sender<Vec<Vec<u8>>> {
    // Inbound: reassemble fragments → full frame → JS event.
    {
        let sink = sink.clone();
        let pid = peer_id.clone();
        let reasm = Arc::new(Mutex::new(VideoReassembler::new()));
        dc.on_message(Box::new(move |msg| {
            let sink = sink.clone();
            let pid = pid.clone();
            let reasm = reasm.clone();
            Box::pin(async move {
                let complete = reasm.lock().unwrap().push(&msg.data);
                if let Some((tag, seq, w, h, jpeg)) = complete {
                    sink.video_frame(&pid, tag, seq, w, h, &jpeg);
                }
            })
        }));
    }

    let (tx, mut rx) = mpsc::channel::<Vec<Vec<u8>>>(3);
    tokio::spawn(async move {
        while let Some(parts) = rx.recv().await {
            if dc.ready_state()
                != webrtc::data_channel::data_channel_state::RTCDataChannelState::Open
            {
                continue;
            }
            // Slow-receiver guard: if SCTP has >1MB queued, drop this frame.
            if dc.buffered_amount().await > 1_000_000 {
                continue;
            }
            for part in parts {
                if dc.send(&bytes::Bytes::from(part)).await.is_err() {
                    break;
                }
            }
        }
    });
    tx
}

async fn apply_signal(
    p: &mut Peer,
    peer_id: &str,
    kind: &str,
    payload: &str,
    sink: &EventSink,
) -> Result<(), webrtc::Error> {
    match kind {
        "offer" => {
            let desc = RTCSessionDescription::offer(payload.to_string())?;
            p.pc.set_remote_description(desc).await?;
            p.remote_set = true;
            flush_ice(p).await;
            let answer = p.pc.create_answer(None).await?;
            p.pc.set_local_description(answer.clone()).await?;
            sink.signal_out(peer_id, 2, &answer.sdp);
        }
        "answer" => {
            let desc = RTCSessionDescription::answer(payload.to_string())?;
            p.pc.set_remote_description(desc).await?;
            p.remote_set = true;
            flush_ice(p).await;
        }
        "ice" => {
            if let Ok(cand) = serde_json::from_str::<RTCIceCandidateInit>(payload) {
                if p.remote_set {
                    let _ = p.pc.add_ice_candidate(cand).await;
                } else {
                    p.pending_ice.push(cand);
                }
            }
        }
        _ => {}
    }
    Ok(())
}

async fn flush_ice(p: &mut Peer) {
    for cand in p.pending_ice.drain(..) {
        let _ = p.pc.add_ice_candidate(cand).await;
    }
}

// ── spike test: SCTP message size + throughput ────────────────────────────────
//
// Validates the two webrtc-rs risks called out in the migration plan BEFORE any
// UI integration: (1) data-channel messages far above 64KB actually arrive,
// (2) sustained ~200KB × 60/s (≈96Mbit) doesn't stall. Run with:
//   cargo test --release rtc_spike -- --nocapture --ignored
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering as AtOrd};

    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn rtc_spike_large_messages() {
        let api_a = build_api().await.unwrap();
        let api_b = build_api().await.unwrap();
        let cfg = || RTCConfiguration::default(); // host candidates only — in-process
        let a = Arc::new(api_a.new_peer_connection(cfg()).await.unwrap());
        let b = Arc::new(api_b.new_peer_connection(cfg()).await.unwrap());

        // Trickle ICE directly across.
        {
            let b2 = b.clone();
            a.on_ice_candidate(Box::new(move |c| {
                let b2 = b2.clone();
                Box::pin(async move {
                    if let Some(c) = c {
                        let _ = b2.add_ice_candidate(c.to_json().unwrap()).await;
                    }
                })
            }));
            let a2 = a.clone();
            b.on_ice_candidate(Box::new(move |c| {
                let a2 = a2.clone();
                Box::pin(async move {
                    if let Some(c) = c {
                        let _ = a2.add_ice_candidate(c.to_json().unwrap()).await;
                    }
                })
            }));
        }

        let received = Arc::new(AtomicUsize::new(0));
        let bytes_ok = Arc::new(AtomicUsize::new(0));
        {
            let received = received.clone();
            let bytes_ok = bytes_ok.clone();
            let reasm = Arc::new(Mutex::new(VideoReassembler::new()));
            b.on_data_channel(Box::new(move |dc: Arc<RTCDataChannel>| {
                let received = received.clone();
                let bytes_ok = bytes_ok.clone();
                let reasm = reasm.clone();
                Box::pin(async move {
                    dc.on_message(Box::new(move |msg| {
                        let complete = reasm.lock().unwrap().push(&msg.data);
                        if let Some((_tag, _seq, _w, _h, jpeg)) = complete {
                            received.fetch_add(1, AtOrd::SeqCst);
                            bytes_ok.fetch_add(jpeg.len(), AtOrd::SeqCst);
                        }
                        Box::pin(async {})
                    }));
                })
            }));
        }

        let dc = a
            .create_data_channel(
                "video",
                Some(RTCDataChannelInit { ordered: Some(false), ..Default::default() }),
            )
            .await
            .unwrap();

        let offer = a.create_offer(None).await.unwrap();
        a.set_local_description(offer.clone()).await.unwrap();
        b.set_remote_description(offer).await.unwrap();
        let answer = b.create_answer(None).await.unwrap();
        b.set_local_description(answer.clone()).await.unwrap();
        a.set_remote_description(answer).await.unwrap();

        // Wait for the channel to open.
        let opened = Arc::new(tokio::sync::Notify::new());
        {
            let opened = opened.clone();
            dc.on_open(Box::new(move || {
                let opened = opened.clone();
                Box::pin(async move { opened.notify_one() })
            }));
        }
        tokio::time::timeout(std::time::Duration::from_secs(10), opened.notified())
            .await
            .expect("data channel never opened");

        // 120 frames of 200KB at ~60/s, sent through the production fragmentation
        // path (SCTP rejects raw messages above the negotiated max-message-size).
        const N: usize = 120;
        const SIZE: usize = 200_000;
        let jpeg = vec![0xAB; SIZE];
        let t0 = std::time::Instant::now();
        for i in 0..N {
            for part in fragment_video(1, i as u32, 1920, 1080, &jpeg) {
                dc.send(&bytes::Bytes::from(part)).await.expect("send failed");
            }
            if i % 2 == 1 {
                tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            }
        }
        // Allow the tail to flush. `received` counts reassembled FRAMES.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        while received.load(AtOrd::SeqCst) < N && std::time::Instant::now() < deadline {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        let got = received.load(AtOrd::SeqCst);
        let total = bytes_ok.load(AtOrd::SeqCst);
        let secs = t0.elapsed().as_secs_f64();
        eprintln!(
            "[spike] reassembled {got}/{N} frames, {total} bytes in {secs:.2}s ({:.1} Mbit/s)",
            (total as f64 * 8.0) / secs / 1e6
        );
        // The channel is unordered, so a frame that completes after a newer one is
        // dropped as stale by design — allow a small shortfall, but not silence.
        assert!(got >= N - 6, "too few frames reassembled: {got}/{N}");
        assert_eq!(total, got * SIZE, "payload bytes corrupted/truncated");

        let _ = a.close().await;
        let _ = b.close().await;
    }
}
