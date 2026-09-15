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
//!   "vcodec" — ordered, reliable: H.264 screen share (tag 3). Inter frames need
//!             every frame before them, so nothing may arrive out of order; a
//!             peer whose link drops a frame gets no more until the next
//!             keyframe. Created by the initiator like the others; a client that
//!             predates it ignores the label and keeps receiving JPEG, as does
//!             any peer that hasn't announced it can decode H.264
//!             (`set_peer_caps`).
//!
//! Wire framing (peer → peer):
//!   audio DC: [u8 tag (1=mic, 2=desktop-audio)][u32-LE rate][i16-LE pcm...]
//!   video DC (per fragment — SCTP rejects messages above the negotiated
//!   max-message-size (~64KB), so JPEG frames are app-fragmented and
//!   reassembled on the receiver; the channel is reliable so all parts arrive):
//!     [u8 tag (1=screen, 2=camera)][u32-LE seq][u16-LE part][u16-LE parts]
//!     [u32-LE w][u32-LE h][chunk...]
//!   vcodec DC: the same fragments with tag 3, whose frame payload is
//!     [u8 flags (bit0 = keyframe)][u64-LE timestamp µs][H.264 Annex B...];
//!     plus a bare [0xF0] from a viewer asking the sharer for a keyframe.
//!
//! rtc_events framing (Rust → JS, first byte = event type):
//!   0x01 signal-out:  [u8 kind (1=offer,2=answer,3=ice)][u16-LE id_len][peer_id][payload utf8]
//!   0x02 conn-state:  [u8 state][u16-LE id_len][peer_id]
//!                     (state: 0=connecting,1=connected,2=disconnected,3=failed,4=closed)
//!   0x03 video frame: [u8 tag][u16-LE id_len][peer_id][u32-LE seq][u32-LE w][u32-LE h][payload]
//!                     (tags 1/2: a JPEG; tag 3: the vcodec frame payload above)
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

/// Fan a JPEG video frame out (screen share / camera). With `jpeg_peers_only`,
/// peers taking the H.264 stream are skipped.
pub fn broadcast_video_frame(tag: u8, w: u32, h: u32, jpeg: Vec<u8>, jpeg_peers_only: bool) {
    if let Some(hd) = ACTIVE.lock().unwrap().as_ref() {
        hd.send(RtcCmd::BroadcastVideo { tag, w, h, jpeg, jpeg_peers_only });
    }
}

// ── H.264 screen share ─────────────────────────────────────────────────────────

/// Frame payload flag: the access unit is a keyframe (IDR with SPS/PPS).
const CODEC_FLAG_KEY: u8 = 1;
/// vcodec control message: the viewer's decoder needs a keyframe.
const CODEC_KEYFRAME_REQUEST: u8 = 0xF0;
/// Tag of an H.264 screen frame on the wire and in the 0x03 event.
pub const TAG_SCREEN_H264: u8 = 3;
/// A backlog that has grown frame after frame this many times in a row means
/// the link takes less than we send: congestion, bring the bitrate down. A
/// single deep backlog doesn't — a keyframe alone is 100–200KB, and a local
/// link at 12Mbit measured 400KB+ momentarily with nothing wrong.
const CODEC_GROWTH_FRAMES: u32 = 8;
/// Floor for the growth rule: backlogs this small drain within a frame or two.
const CODEC_GROWTH_MIN_BYTES: usize = 256_000;
/// Backlog that counts as congestion outright (~1s at 12Mbit).
const CODEC_CONGESTED_BYTES: usize = 1_500_000;
/// Backlog past which frames are dropped for that peer until the next keyframe.
const CODEC_DROP_BYTES: usize = 3_000_000;

/// Which peers decode H.264: announced from JS, kept across reconnects of the
/// same peer (the announcement isn't repeated), cleared when the call ends.
static PEER_H264_CAPS: Mutex<Option<HashMap<String, bool>>> = Mutex::new(None);
/// Peers with an H.264 channel up.
static PEER_CODEC_OPEN: Mutex<Option<HashMap<String, ()>>> = Mutex::new(None);
/// Peers connected at all (JPEG is everyone not on H.264).
static PEER_COUNT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
/// A viewer needs a keyframe: it just joined, its link dropped a frame, or its
/// decoder asked. The capture loop turns this into an encoder request.
static KEYFRAME_WANTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Congestion events since the last read, for the bitrate controller.
static CONGESTION: AtomicU32 = AtomicU32::new(0);

fn caps_accepts(peer_id: &str) -> bool {
    PEER_H264_CAPS.lock().unwrap().as_ref().and_then(|m| m.get(peer_id).copied()).unwrap_or(false)
}

fn codec_open(peer_id: &str) -> bool {
    PEER_CODEC_OPEN.lock().unwrap().as_ref().is_some_and(|m| m.contains_key(peer_id))
}

fn set_codec_open(peer_id: &str, open: bool) {
    let mut g = PEER_CODEC_OPEN.lock().unwrap();
    let m = g.get_or_insert_with(HashMap::new);
    if open {
        m.insert(peer_id.to_string(), ());
    } else {
        m.remove(peer_id);
    }
}

/// Whether `peer_id` gets the H.264 stream rather than JPEG.
fn takes_h264(peer_id: &str) -> bool {
    codec_open(peer_id) && caps_accepts(peer_id)
}

/// Record whether a peer can decode H.264 (from its join/hello announcement).
pub fn set_peer_caps(peer_id: &str, h264: bool) {
    PEER_H264_CAPS.lock().unwrap().get_or_insert_with(HashMap::new).insert(peer_id.to_string(), h264);
    if h264 {
        KEYFRAME_WANTED.store(true, Ordering::SeqCst);
    }
}

/// (peers taking H.264, peers needing JPEG) right now.
pub fn video_audience() -> (usize, usize) {
    let total = PEER_COUNT.load(Ordering::Relaxed);
    let open = PEER_CODEC_OPEN.lock().unwrap();
    let h264 = open.as_ref().map_or(0, |m| m.keys().filter(|p| caps_accepts(p)).count());
    (h264, total.saturating_sub(h264))
}

/// Takes a pending keyframe request from any viewer.
pub fn take_keyframe_request() -> bool {
    KEYFRAME_WANTED.swap(false, Ordering::SeqCst)
}

/// Congestion events since the last call.
pub fn take_congestion() -> u32 {
    CONGESTION.swap(0, Ordering::Relaxed)
}

/// Fan an encoded H.264 access unit out to every peer taking H.264.
pub fn broadcast_h264_frame(key: bool, w: u32, h: u32, timestamp_us: u64, data: Vec<u8>) {
    if let Some(hd) = ACTIVE.lock().unwrap().as_ref() {
        hd.send(RtcCmd::BroadcastH264 { key, w, h, timestamp_us, data });
    }
}

/// Ask the sharer `peer_id` for a keyframe (our decoder lost the stream).
pub fn request_keyframe(peer_id: String) {
    if let Some(hd) = ACTIVE.lock().unwrap().as_ref() {
        hd.send(RtcCmd::RequestKeyframe { peer_id });
    }
}

/// An H.264 frame queued for one peer's vcodec channel.
#[derive(Clone)]
struct CodecFrame {
    key: bool,
    parts: Arc<Vec<Vec<u8>>>,
}

/// Per-peer H.264 channel state, shared by the broadcaster, the send task and
/// the inbound handler.
struct CodecSlot {
    tx: Mutex<Option<mpsc::Sender<CodecFrame>>>,
    dc: Mutex<Option<Arc<RTCDataChannel>>>,
    /// No inter frames until a keyframe gets through (fresh channel, or a drop).
    needs_key: std::sync::atomic::AtomicBool,
}

impl CodecSlot {
    fn new() -> Arc<Self> {
        Arc::new(CodecSlot {
            tx: Mutex::new(None),
            dc: Mutex::new(None),
            needs_key: std::sync::atomic::AtomicBool::new(true),
        })
    }

    /// Marks the peer as needing a keyframe and asks for one.
    fn lost_frame(&self) {
        self.needs_key.store(true, Ordering::SeqCst);
        KEYFRAME_WANTED.store(true, Ordering::SeqCst);
    }
}

/// Tells real congestion (a backlog that keeps growing, or a deep one) from the
/// momentary bumps a keyframe or a burst of detail causes.
#[derive(Default)]
struct BacklogTrend {
    last: usize,
    growing: u32,
}

impl BacklogTrend {
    fn congested(&mut self, backlog: usize) -> bool {
        self.growing = if backlog > self.last && backlog >= CODEC_GROWTH_MIN_BYTES { self.growing + 1 } else { 0 };
        self.last = backlog;
        backlog > CODEC_CONGESTED_BYTES || self.growing >= CODEC_GROWTH_FRAMES
    }
}

/// Payload of one H.264 frame on the wire (before fragmentation).
fn codec_payload(key: bool, timestamp_us: u64, data: &[u8]) -> Vec<u8> {
    let mut p = Vec::with_capacity(9 + data.len());
    p.push(if key { CODEC_FLAG_KEY } else { 0 });
    p.extend_from_slice(&timestamp_us.to_le_bytes());
    p.extend_from_slice(data);
    p
}

/// Wires a vcodec channel for `peer_id`: the send task (with keyframe gating
/// and congestion accounting) and the inbound side (frames to JS, keyframe
/// requests to the capture loop).
fn wire_codec_dc(dc: Arc<RTCDataChannel>, slot: &Arc<CodecSlot>, sink: &EventSink, peer_id: &str) {
    {
        let sink = sink.clone();
        let pid = peer_id.to_string();
        let slot = slot.clone();
        let reasm = Arc::new(Mutex::new(VideoReassembler::new()));
        dc.on_message(Box::new(move |msg| {
            if msg.data.len() == 1 && msg.data[0] == CODEC_KEYFRAME_REQUEST {
                slot.lost_frame();
            } else if let Some((tag, seq, w, h, payload)) = reasm.lock().unwrap().push(&msg.data) {
                sink.video_frame(&pid, tag, seq, w, h, &payload);
            }
            Box::pin(async {})
        }));
    }
    {
        let pid = peer_id.to_string();
        dc.on_open(Box::new(move || {
            set_codec_open(&pid, true);
            KEYFRAME_WANTED.store(true, Ordering::SeqCst);
            Box::pin(async {})
        }));
    }
    {
        let pid = peer_id.to_string();
        dc.on_close(Box::new(move || {
            set_codec_open(&pid, false);
            Box::pin(async {})
        }));
    }
    if dc.ready_state() == webrtc::data_channel::data_channel_state::RTCDataChannelState::Open {
        set_codec_open(peer_id, true);
    }

    let (tx, mut rx) = mpsc::channel::<CodecFrame>(8);
    *slot.tx.lock().unwrap() = Some(tx);
    *slot.dc.lock().unwrap() = Some(dc.clone());
    let slot = slot.clone();
    tokio::spawn(async move {
        let mut backlog_trend = BacklogTrend::default();
        while let Some(frame) = rx.recv().await {
            if dc.ready_state() != webrtc::data_channel::data_channel_state::RTCDataChannelState::Open {
                continue;
            }
            if frame.key {
                slot.needs_key.store(false, Ordering::SeqCst);
            } else if slot.needs_key.load(Ordering::SeqCst) {
                continue;
            }
            let backlog = dc.buffered_amount().await;
            if backlog > CODEC_DROP_BYTES {
                CONGESTION.fetch_add(1, Ordering::Relaxed);
                slot.lost_frame();
                continue;
            }
            if backlog_trend.congested(backlog) {
                CONGESTION.fetch_add(1, Ordering::Relaxed);
            }
            for part in frame.parts.iter() {
                if dc.send(&bytes::Bytes::copy_from_slice(part)).await.is_err() {
                    slot.lost_frame();
                    break;
                }
            }
        }
    });
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
    BroadcastVideo { tag: u8, w: u32, h: u32, jpeg: Vec<u8>, jpeg_peers_only: bool },
    BroadcastH264 { key: bool, w: u32, h: u32, timestamp_us: u64, data: Vec<u8> },
    RequestKeyframe { peer_id: String },
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
    /// The H.264 channel, once it exists (see `wire_codec_dc`).
    codec: Arc<CodecSlot>,
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
                            set_codec_open(&peer_id, false);
                            match new_peer(&peer_id, initiator, &ice_servers, &sink, &ingest).await {
                                Ok(peer) => {
                                    peers.insert(peer_id, Arc::new(tokio::sync::Mutex::new(peer)));
                                }
                                Err(e) => eprintln!("[rtc] create_peer({peer_id}) failed: {e}"),
                            }
                            PEER_COUNT.store(peers.len(), Ordering::Relaxed);
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
                            set_codec_open(&peer_id, false);
                            PEER_COUNT.store(peers.len(), Ordering::Relaxed);
                        }

                        RtcCmd::CloseAll => {
                            for (peer_id, peer) in peers.drain() {
                                let p = peer.lock().await;
                                let _ = p.pc.close().await;
                                audio::mixer_remove_peer(&peer_id);
                                audio::mixer_remove_peer(&format!("{peer_id}:screen"));
                            }
                            *PEER_CODEC_OPEN.lock().unwrap() = None;
                            *PEER_H264_CAPS.lock().unwrap() = None;
                            PEER_COUNT.store(0, Ordering::Relaxed);
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

                        RtcCmd::BroadcastH264 { key, w, h, timestamp_us, data } => {
                            let seq = video_seq.fetch_add(1, Ordering::Relaxed);
                            let payload = codec_payload(key, timestamp_us, &data);
                            let frame = CodecFrame { key, parts: Arc::new(fragment_video(TAG_SCREEN_H264, seq, w, h, &payload)) };
                            for (peer_id, peer) in peers.iter() {
                                if !takes_h264(peer_id) {
                                    continue;
                                }
                                let Ok(p) = peer.try_lock() else { continue };
                                let slot = p.codec.clone();
                                drop(p);
                                if !key && slot.needs_key.load(Ordering::SeqCst) {
                                    KEYFRAME_WANTED.store(true, Ordering::SeqCst);
                                    continue;
                                }
                                let tx = slot.tx.lock().unwrap().clone();
                                if let Some(tx) = tx {
                                    if tx.try_send(frame.clone()).is_err() {
                                        CONGESTION.fetch_add(1, Ordering::Relaxed);
                                        slot.lost_frame();
                                    }
                                }
                            }
                        }

                        RtcCmd::RequestKeyframe { peer_id } => {
                            let Some(peer) = peers.get(&peer_id).cloned() else { continue };
                            tokio::spawn(async move {
                                let dc = peer.lock().await.codec.dc.lock().unwrap().clone();
                                if let Some(dc) = dc {
                                    let _ = dc.send(&bytes::Bytes::from_static(&[CODEC_KEYFRAME_REQUEST])).await;
                                }
                            });
                        }

                        RtcCmd::BroadcastVideo { tag, w, h, jpeg, jpeg_peers_only } => {
                            let seq = video_seq.fetch_add(1, Ordering::Relaxed);
                            let parts = fragment_video(tag, seq, w, h, &jpeg);
                            for (peer_id, peer) in peers.iter() {
                                if jpeg_peers_only && takes_h264(peer_id) {
                                    continue;
                                }
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
        codec: CodecSlot::new(),
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
        let codec_dc = pc
            .create_data_channel("vcodec", Some(RTCDataChannelInit { ordered: Some(true), ..Default::default() }))
            .await?;
        wire_codec_dc(codec_dc, &peer.codec, sink, peer_id);
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
        let codec_slot = peer.codec.clone();
        pc.on_data_channel(Box::new(move |dc: Arc<RTCDataChannel>| {
            let sink = sink2.clone();
            let ingest = ingest2.clone();
            let pid = pid.clone();
            let audio_slot = audio_slot.clone();
            let video_slot = video_slot.clone();
            let codec_slot = codec_slot.clone();
            Box::pin(async move {
                match dc.label() {
                    "vcodec" => wire_codec_dc(dc, &codec_slot, &sink, &pid),
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

    #[test]
    fn peers_take_h264_only_with_an_open_channel_and_announced_support() {
        set_codec_open("aud-both", true);
        set_peer_caps("aud-both", true);
        set_codec_open("aud-old-client", true); // channel up, never announced
        set_peer_caps("aud-no-webcodecs", false);
        set_codec_open("aud-no-webcodecs", true);
        set_peer_caps("aud-no-channel", true); // announced, but its client predates vcodec

        assert!(takes_h264("aud-both"));
        assert!(!takes_h264("aud-old-client"));
        assert!(!takes_h264("aud-no-webcodecs"));
        assert!(!takes_h264("aud-no-channel"));

        set_codec_open("aud-both", false);
        assert!(!takes_h264("aud-both"), "a closed channel still counted");
    }

    #[test]
    fn backlog_bumps_are_not_congestion_but_sustained_growth_is() {
        let mut t = BacklogTrend::default();
        // A keyframe-sized bump that drains: never congestion.
        for b in [50_000, 600_000, 300_000, 40_000, 20_000] {
            assert!(!t.congested(b), "bump at {b} counted");
        }
        // Growth below the floor: a healthy link filling a little.
        let mut t = BacklogTrend::default();
        assert!((1..30).all(|i| !t.congested(i * 5_000)));
        // Growth that keeps going past the floor.
        let mut t = BacklogTrend::default();
        let hits: Vec<bool> = (0..CODEC_GROWTH_FRAMES + 1).map(|i| t.congested(300_000 + i as usize * 50_000)).collect();
        assert!(!hits[..CODEC_GROWTH_FRAMES as usize - 1].iter().any(|&c| c));
        assert!(hits[CODEC_GROWTH_FRAMES as usize - 1]);
        // A deep backlog counts outright.
        assert!(BacklogTrend::default().congested(CODEC_CONGESTED_BYTES + 1));
    }

    #[test]
    fn codec_payload_carries_flag_timestamp_and_stream() {
        let p = codec_payload(true, 123_456, &[0, 0, 1, 0x65]);
        assert_eq!(p[0], CODEC_FLAG_KEY);
        assert_eq!(u64::from_le_bytes(p[1..9].try_into().unwrap()), 123_456);
        assert_eq!(&p[9..], &[0, 0, 1, 0x65]);
        assert_eq!(codec_payload(false, 0, &[])[0], 0);
    }

    /// Two in-process peers over a real vcodec channel: inter frames are held
    /// back until a keyframe, everything after arrives complete and in order,
    /// and a viewer's keyframe request reaches the sharer and gates it again.
    #[tokio::test(flavor = "multi_thread")]
    async fn vcodec_channel_gates_on_keyframes_and_carries_requests() {
        let a = Arc::new(build_api().await.unwrap().new_peer_connection(RTCConfiguration::default()).await.unwrap());
        let b = Arc::new(build_api().await.unwrap().new_peer_connection(RTCConfiguration::default()).await.unwrap());
        for (from, to) in [(a.clone(), b.clone()), (b.clone(), a.clone())] {
            from.on_ice_candidate(Box::new(move |c| {
                let to = to.clone();
                Box::pin(async move {
                    if let Some(c) = c {
                        let _ = to.add_ice_candidate(c.to_json().unwrap()).await;
                    }
                })
            }));
        }

        // Viewer side: frames reaching JS are recorded as 0x03 events.
        let events: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));
        let ev = events.clone();
        let sink_b = EventSink(Arc::new(Channel::new(move |body| {
            if let InvokeResponseBody::Raw(bytes) = body {
                if bytes.first() == Some(&0x03) {
                    ev.lock().unwrap().push(bytes);
                }
            }
            Ok(())
        })));
        let slot_b = CodecSlot::new();
        {
            let slot_b = slot_b.clone();
            b.on_data_channel(Box::new(move |dc: Arc<RTCDataChannel>| {
                let (slot_b, sink_b) = (slot_b.clone(), sink_b.clone());
                Box::pin(async move { wire_codec_dc(dc, &slot_b, &sink_b, "vc-sharer") })
            }));
        }

        // Sharer side.
        let sink_a = EventSink(Arc::new(Channel::new(|_| Ok(()))));
        let slot_a = CodecSlot::new();
        let dc = a
            .create_data_channel("vcodec", Some(RTCDataChannelInit { ordered: Some(true), ..Default::default() }))
            .await
            .unwrap();
        wire_codec_dc(dc, &slot_a, &sink_a, "vc-viewer");

        let offer = a.create_offer(None).await.unwrap();
        a.set_local_description(offer.clone()).await.unwrap();
        b.set_remote_description(offer).await.unwrap();
        let answer = b.create_answer(None).await.unwrap();
        b.set_local_description(answer.clone()).await.unwrap();
        a.set_remote_description(answer).await.unwrap();

        let wait = |cond: &dyn Fn() -> bool| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            while !cond() && std::time::Instant::now() < deadline {
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            cond()
        };
        assert!(wait(&|| codec_open("vc-viewer") && codec_open("vc-sharer")), "vcodec channel never opened");

        let send = |seq: u32, key: bool| {
            // 60KB frames: several fragments each, so ordering is really exercised.
            let payload = codec_payload(key, seq as u64 * 1000, &vec![seq as u8; 60_000]);
            let frame = CodecFrame { key, parts: Arc::new(fragment_video(TAG_SCREEN_H264, seq, 1280, 720, &payload)) };
            slot_a.tx.lock().unwrap().clone().unwrap().try_send(frame).unwrap();
        };
        let received = || -> Vec<(u32, bool, u64)> {
            events
                .lock()
                .unwrap()
                .iter()
                .map(|e| {
                    let id_len = u16::from_le_bytes([e[2], e[3]]) as usize;
                    let body = &e[4 + id_len..];
                    assert_eq!(e[1], TAG_SCREEN_H264);
                    let seq = u32::from_le_bytes(body[0..4].try_into().unwrap());
                    let p = &body[12..];
                    assert_eq!(p.len(), 9 + 60_000, "frame truncated");
                    (seq, p[0] & CODEC_FLAG_KEY != 0, u64::from_le_bytes(p[1..9].try_into().unwrap()))
                })
                .collect()
        };

        send(0, false); // before any keyframe: must not arrive
        send(1, true);
        for seq in 2..8 {
            send(seq, false);
        }
        assert!(wait(&|| received().len() >= 7), "frames missing: {:?}", received());
        let got = received();
        assert_eq!(got.iter().map(|f| f.0).collect::<Vec<_>>(), (1..8).collect::<Vec<_>>());
        assert!(got[0].1 && got[1..].iter().all(|f| !f.1));
        assert_eq!(got[3].2, 4000);

        // The viewer's decoder asks for a keyframe.
        let _ = take_keyframe_request();
        let dc_b = slot_b.dc.lock().unwrap().clone().unwrap();
        dc_b.send(&bytes::Bytes::from_static(&[CODEC_KEYFRAME_REQUEST])).await.unwrap();
        assert!(wait(&|| slot_a.needs_key.load(Ordering::SeqCst)), "request never reached the sharer");
        assert!(take_keyframe_request());

        send(8, false); // held back again
        send(9, true);
        assert!(wait(&|| received().len() >= 8));
        std::thread::sleep(std::time::Duration::from_millis(200));
        let got = received();
        assert_eq!(got.last().map(|f| (f.0, f.1)), Some((9, true)));
        assert!(!got.iter().any(|f| f.0 == 8), "inter frame after a keyframe request was sent");

        let _ = a.close().await;
        let _ = b.close().await;
    }
}
