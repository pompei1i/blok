//! H.264 encoding for screen share.
//!
//! JPEG-per-frame cost ~30ms of CPU and ~400KB for a 1080p video frame — 77Mbit
//! at 24fps, far past a home uplink, and CPU the shared app and the viewers'
//! decoders needed. H.264 carries the same picture at a few Mbit.
//!
//! Encoders are tried best-first, so every machine gets the cheapest one it has:
//!   1. a hardware encoder through Media Foundation (NVENC, Quick Sync, AMF) —
//!      Windows only, see `h264_mf`;
//!   2. openh264, built into blok from source — any x86 machine, any OS.
//!      Measured here: 1080p in ~6ms, 720p in ~2.4ms per frame on one core
//!      (with its assembly; without NASM at build time it is ~3x slower).
//!
//! Each encoder runs on its own thread behind a single-slot input: a frame
//! arriving while the previous one is still encoding is dropped rather than
//! queued, so latency never builds up, and the drop is counted for the
//! adaptation loop in `lib.rs`.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Instant;

/// One encoded access unit in Annex B form (start codes), SPS/PPS inline on
/// keyframes so a viewer can start decoding from any keyframe.
pub struct EncodedFrame {
    pub data: Vec<u8>,
    pub key: bool,
    pub timestamp_us: u64,
}

/// A captured frame on its way into an encoder: tightly packed BGRA.
pub struct RawFrame {
    pub bgra: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub timestamp_us: u64,
}

/// Settings and counters shared between the capture loop and an encoder thread.
#[derive(Default)]
pub struct Control {
    force_key: AtomicBool,
    bitrate: AtomicU32,
    encoded: AtomicU32,
    busy_drops: AtomicU32,
    encode_us: AtomicU64,
    bytes: AtomicU64,
}

impl Control {
    /// Takes a pending keyframe request.
    pub fn take_keyframe_request(&self) -> bool {
        self.force_key.swap(false, Ordering::SeqCst)
    }

    pub fn bitrate(&self) -> u32 {
        self.bitrate.load(Ordering::Relaxed)
    }

    /// Records one encoded frame and what it cost.
    pub fn record(&self, started: Instant, bytes: usize) {
        self.encoded.fetch_add(1, Ordering::Relaxed);
        self.encode_us.fetch_add(started.elapsed().as_micros() as u64, Ordering::Relaxed);
        self.bytes.fetch_add(bytes as u64, Ordering::Relaxed);
    }
}

/// Throughput since the previous `take_stats`.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct EncoderStats {
    pub encoded: u32,
    /// Frames offered while the encoder was still busy with the last one.
    pub busy_drops: u32,
    pub avg_encode_ms: f64,
    pub bytes: u64,
}

/// A running encoder, whichever backend it is.
pub struct H264Encoder {
    input: Option<mpsc::SyncSender<RawFrame>>,
    control: Arc<Control>,
    thread: Option<std::thread::JoinHandle<()>>,
    pub name: String,
    pub width: u32,
    pub height: u32,
}

/// Target bitrate: ~0.1 bit per pixel per frame, scaled by the quality setting
/// (1.0 high, 0.6 medium, 0.35 low), within what uplinks and decoders handle.
pub fn bitrate_for(width: u32, height: u32, fps: u32, quality: f64) -> u32 {
    let raw = width as f64 * height as f64 * fps as f64 * 0.1 * quality;
    raw.clamp(MIN_BITRATE as f64, MAX_BITRATE as f64) as u32
}

pub const MIN_BITRATE: u32 = 500_000;
pub const MAX_BITRATE: u32 = 20_000_000;

/// Largest even size not above `w`x`h`: 4:2:0 chroma needs even dimensions.
pub fn even_size(w: u32, h: u32) -> (u32, u32) {
    (w & !1, h & !1)
}

impl H264Encoder {
    /// Opens the best available encoder for `width`x`height` (even). `on_output`
    /// runs on the encoder thread for every encoded frame.
    pub fn open(
        width: u32,
        height: u32,
        fps: u32,
        bitrate: u32,
        on_output: impl Fn(EncodedFrame) + Send + Sync + 'static,
    ) -> Result<Self, String> {
        let on_output: Arc<dyn Fn(EncodedFrame) + Send + Sync> = Arc::new(on_output);
        #[cfg(target_os = "windows")]
        {
            let out = on_output.clone();
            match Self::spawn(width, height, bitrate, move |rx, control, ready| {
                crate::h264_mf::run(width, height, fps, rx, control, ready, &*out)
            }) {
                Ok(enc) => return Ok(enc),
                Err(e) => eprintln!("[h264] no hardware encoder ({e}); using openh264"),
            }
        }
        Self::open_software(width, height, fps, bitrate, move |f| on_output(f))
    }

    /// Opens openh264 directly (the fallback, and what tests use for determinism).
    pub fn open_software(
        width: u32,
        height: u32,
        fps: u32,
        bitrate: u32,
        on_output: impl Fn(EncodedFrame) + Send + 'static,
    ) -> Result<Self, String> {
        Self::spawn(width, height, bitrate, move |rx, control, ready| {
            run_openh264(width, height, fps, rx, control, ready, &on_output)
        })
    }

    /// Starts `body` on the encoder thread. `body` reports its encoder name (or
    /// why it couldn't open) through `ready` before taking frames.
    fn spawn(
        width: u32,
        height: u32,
        bitrate: u32,
        body: impl FnOnce(mpsc::Receiver<RawFrame>, Arc<Control>, mpsc::Sender<Result<String, String>>) + Send + 'static,
    ) -> Result<Self, String> {
        if width < 2 || height < 2 || width % 2 != 0 || height % 2 != 0 {
            return Err(format!("unsupported frame size {width}x{height}"));
        }
        let (input_tx, input_rx) = mpsc::sync_channel::<RawFrame>(1);
        let (ready_tx, ready_rx) = mpsc::channel();
        let control = Arc::new(Control::default());
        control.bitrate.store(bitrate, Ordering::Relaxed);
        let c = control.clone();
        let thread = std::thread::Builder::new()
            .name("blok-h264".into())
            .spawn(move || body(input_rx, c, ready_tx))
            .map_err(|e| e.to_string())?;
        let name = match ready_rx.recv() {
            Ok(Ok(name)) => name,
            Ok(Err(e)) => {
                let _ = thread.join();
                return Err(e);
            }
            Err(_) => return Err("encoder thread died".into()),
        };
        Ok(H264Encoder { input: Some(input_tx), control, thread: Some(thread), name, width, height })
    }

    /// Offers a frame (must match the encoder's size). Returns false, and counts
    /// a drop, when the encoder is still busy with the previous frame.
    pub fn encode(&self, frame: RawFrame) -> bool {
        let Some(tx) = &self.input else { return false };
        match tx.try_send(frame) {
            Ok(()) => true,
            Err(_) => {
                self.control.busy_drops.fetch_add(1, Ordering::Relaxed);
                false
            }
        }
    }

    /// The next frame the encoder takes is coded as an IDR.
    pub fn request_keyframe(&self) {
        self.control.force_key.store(true, Ordering::SeqCst);
    }

    /// Applied from the next frame on, without restarting the stream.
    pub fn set_bitrate(&self, bps: u32) {
        self.control.bitrate.store(bps.clamp(MIN_BITRATE, MAX_BITRATE), Ordering::Relaxed);
    }

    pub fn bitrate(&self) -> u32 {
        self.control.bitrate()
    }

    pub fn take_stats(&self) -> EncoderStats {
        let c = &self.control;
        let encoded = c.encoded.swap(0, Ordering::Relaxed);
        let us = c.encode_us.swap(0, Ordering::Relaxed);
        EncoderStats {
            encoded,
            busy_drops: c.busy_drops.swap(0, Ordering::Relaxed),
            avg_encode_ms: if encoded > 0 { us as f64 / encoded as f64 / 1000.0 } else { 0.0 },
            bytes: c.bytes.swap(0, Ordering::Relaxed),
        }
    }

    /// Whether the encoder thread is still running (it exits on a fatal error).
    pub fn is_alive(&self) -> bool {
        self.thread.as_ref().is_some_and(|t| !t.is_finished())
    }
}

impl Drop for H264Encoder {
    fn drop(&mut self) {
        // Closing the input ends the encoder loop at its next frame request.
        self.input = None;
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn run_openh264(
    width: u32,
    height: u32,
    fps: u32,
    input: mpsc::Receiver<RawFrame>,
    control: Arc<Control>,
    ready: mpsc::Sender<Result<String, String>>,
    on_output: &(impl Fn(EncodedFrame) + ?Sized),
) {
    use openh264::encoder::{
        BitRate, Complexity, Encoder, EncoderConfig, FrameRate, IntraFramePeriod, QpRange, RateControlMode, UsageType,
    };
    use openh264::formats::YUVSlices;
    use openh264::OpenH264API;

    let mut bitrate = control.bitrate();
    let config = EncoderConfig::new()
        .bitrate(BitRate::from_bps(bitrate))
        .max_frame_rate(FrameRate::from_hz(fps.max(1) as f32))
        .usage_type(UsageType::ScreenContentRealTime)
        .rate_control_mode(RateControlMode::Bitrate)
        .complexity(Complexity::Low)
        .skip_frames(false)
        // The default QP ceiling stops rate control well above a low target on
        // busy content; the full range lets a congested link actually get relief.
        .qp(QpRange::new(10, 51))
        .intra_frame_period(IntraFramePeriod::from_num_frames(fps.max(1) * 2));
    let mut encoder = match Encoder::with_api_config(OpenH264API::from_source(), config) {
        Ok(e) => e,
        Err(e) => {
            let _ = ready.send(Err(format!("openh264: {e}")));
            return;
        }
    };
    let _ = ready.send(Ok("openh264 (software)".into()));

    let (w, h) = (width as usize, height as usize);
    let mut y = vec![0u8; w * h];
    let mut u = vec![0u8; w * h / 4];
    let mut v = vec![0u8; w * h / 4];
    while let Ok(frame) = input.recv() {
        if frame.width != width || frame.height != height {
            continue;
        }
        let started = Instant::now();
        let wanted = control.bitrate();
        if wanted != bitrate {
            bitrate = wanted;
            let mut info = openh264_sys2::SBitrateInfo { iLayer: openh264_sys2::SPATIAL_LAYER_ALL, iBitrate: bitrate as i32 };
            // SAFETY: a documented runtime option; the struct outlives the call.
            unsafe {
                let _ = encoder.raw_api().set_option(openh264_sys2::ENCODER_OPTION_BITRATE, (&mut info as *mut openh264_sys2::SBitrateInfo).cast());
            }
        }
        if control.take_keyframe_request() {
            encoder.force_intra_frame();
        }
        bgra_to_i420(&frame.bgra, width, height, &mut y, &mut u, &mut v);
        let src = YUVSlices::new((&y, &u, &v), (w, h), (w, w / 2, w / 2));
        let data = match encoder.encode(&src) {
            Ok(bits) => {
                let key = matches!(bits.frame_type(), openh264::encoder::FrameType::IDR | openh264::encoder::FrameType::I);
                (bits.to_vec(), key)
            }
            Err(e) => {
                eprintln!("[h264] openh264 encode failed: {e}");
                return;
            }
        };
        if data.0.is_empty() {
            continue; // rate control skipped the frame
        }
        control.record(started, data.0.len());
        on_output(EncodedFrame { data: data.0, key: data.1, timestamp_us: frame.timestamp_us });
    }
}

// ── colour conversion ─────────────────────────────────────────────────────────
//
// BT.709 limited range, the colourimetry WebCodecs and the hardware decoders
// assume for HD content without VUI. Chroma is the mean of each 2x2 block.

#[inline(always)]
fn luma(b: i32, g: i32, r: i32) -> u8 {
    (((47 * r + 157 * g + 16 * b + 128) >> 8) + 16) as u8
}

#[inline(always)]
fn chroma(b: i32, g: i32, r: i32) -> (u8, u8) {
    let cb = ((-26 * r - 86 * g + 112 * b + 128) >> 8) + 128;
    let cr = ((112 * r - 102 * g - 10 * b + 128) >> 8) + 128;
    (cb.clamp(0, 255) as u8, cr.clamp(0, 255) as u8)
}

fn fill_luma(bgra: &[u8], w: usize, y_plane: &mut [u8]) {
    for (row, dst) in y_plane.chunks_exact_mut(w).enumerate() {
        let src = &bgra[row * w * 4..(row + 1) * w * 4];
        for (y, px) in dst.iter_mut().zip(src.chunks_exact(4)) {
            *y = luma(px[0] as i32, px[1] as i32, px[2] as i32);
        }
    }
}

/// Mean BGR of the 2x2 block whose top-left pixel is (`x`*2, `row`*2).
#[inline(always)]
fn block_mean(bgra: &[u8], w: usize, row: usize, x: usize) -> (i32, i32, i32) {
    let top = row * 2 * w * 4 + x * 8;
    let bottom = top + w * 4;
    let mut sum = [0i32; 3];
    for o in [top, top + 4, bottom, bottom + 4] {
        sum[0] += bgra[o] as i32;
        sum[1] += bgra[o + 1] as i32;
        sum[2] += bgra[o + 2] as i32;
    }
    (sum[0] >> 2, sum[1] >> 2, sum[2] >> 2)
}

/// BGRA → I420 (planar Y, U, V) for openh264. Dimensions must be even.
pub fn bgra_to_i420(bgra: &[u8], width: u32, height: u32, y: &mut [u8], u: &mut [u8], v: &mut [u8]) {
    let (w, h) = (width as usize, height as usize);
    fill_luma(bgra, w, &mut y[..w * h]);
    let cw = w / 2;
    for row in 0..h / 2 {
        for x in 0..cw {
            let (b, g, r) = block_mean(bgra, w, row, x);
            let (cb, cr) = chroma(b, g, r);
            u[row * cw + x] = cb;
            v[row * cw + x] = cr;
        }
    }
}

/// BGRA → NV12 (Y plane, then interleaved UV) for Media Foundation.
pub fn bgra_to_nv12(bgra: &[u8], width: u32, height: u32, out: &mut [u8]) {
    let (w, h) = (width as usize, height as usize);
    let (y_plane, uv_plane) = out.split_at_mut(w * h);
    fill_luma(bgra, w, y_plane);
    for (row, dst) in uv_plane.chunks_exact_mut(w).take(h / 2).enumerate() {
        for (x, uv) in dst.chunks_exact_mut(2).enumerate() {
            let (b, g, r) = block_mean(bgra, w, row, x);
            let (cb, cr) = chroma(b, g, r);
            uv[0] = cb;
            uv[1] = cr;
        }
    }
}

/// NAL unit types in an Annex B stream, in order.
#[cfg(test)]
pub fn nal_types(data: &[u8]) -> Vec<u8> {
    let mut types = Vec::new();
    let mut i = 0;
    while i + 3 < data.len() {
        if data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1 {
            types.push(data[i + 3] & 0x1f);
            i += 3;
        } else {
            i += 1;
        }
    }
    types
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::time::Duration;

    fn solid(w: u32, h: u32, b: u8, g: u8, r: u8) -> Vec<u8> {
        [b, g, r, 255].repeat((w * h) as usize)
    }

    #[test]
    fn colours_convert_to_bt709_limited_range() {
        // (B, G, R) → expected (Y, Cb, Cr), BT.709 limited range, ±1 for rounding.
        let cases = [
            ((0, 0, 0), (16, 128, 128)),
            ((255, 255, 255), (235, 128, 128)),
            ((0, 0, 255), (63, 102, 240)),
            ((0, 255, 0), (173, 42, 26)),
            ((255, 0, 0), (32, 240, 118)),
        ];
        for ((b, g, r), (ey, ecb, ecr)) in cases {
            let frame = solid(4, 2, b, g, r);
            let mut nv12 = vec![0u8; 12];
            bgra_to_nv12(&frame, 4, 2, &mut nv12);
            let (mut y, mut u, mut v) = (vec![0u8; 8], vec![0u8; 2], vec![0u8; 2]);
            bgra_to_i420(&frame, 4, 2, &mut y, &mut u, &mut v);
            let near = |a: u8, e: i32| (a as i32 - e).abs() <= 1;
            assert!(near(nv12[0], ey) && near(nv12[8], ecb) && near(nv12[9], ecr), "nv12 for {:?}: {:?}", (b, g, r), &nv12[..10]);
            assert!(near(y[0], ey) && near(u[0], ecb) && near(v[0], ecr), "i420 for {:?}", (b, g, r));
        }
    }

    #[test]
    fn chroma_is_the_mean_of_each_block() {
        // Left block black, right block white: chroma neutral, luma per pixel.
        let mut frame = solid(4, 2, 0, 0, 0);
        for x in 2..4 {
            for y in 0..2 {
                let o = (y * 4 + x) * 4;
                frame[o..o + 3].copy_from_slice(&[255, 255, 255]);
            }
        }
        let mut nv12 = vec![0u8; 12];
        bgra_to_nv12(&frame, 4, 2, &mut nv12);
        assert_eq!(&nv12[..4], &[16, 16, 235, 235]);
        assert_eq!(&nv12[8..], &[128, 128, 128, 128]);
    }

    #[test]
    fn bitrate_scales_with_pixels_rate_and_quality_within_bounds() {
        assert_eq!(bitrate_for(1920, 1080, 60, 1.0), 12_441_600);
        assert_eq!(bitrate_for(1920, 1080, 30, 1.0), 6_220_800);
        assert!(bitrate_for(1920, 1080, 30, 0.35) < bitrate_for(1920, 1080, 30, 0.6));
        assert_eq!(bitrate_for(320, 180, 15, 0.35), MIN_BITRATE);
        assert_eq!(bitrate_for(3840, 2160, 60, 1.0), MAX_BITRATE);
    }

    #[test]
    fn even_size_rounds_down() {
        assert_eq!(even_size(1921, 1033), (1920, 1032));
        assert_eq!(even_size(1920, 1080), (1920, 1080));
    }

    #[test]
    fn annex_b_nal_types_are_listed_in_order() {
        let stream = [0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x68, 3, 0, 0, 1, 0x65, 9];
        assert_eq!(nal_types(&stream), vec![7, 8, 5]);
    }

    /// A frame whose content moves with `i`, so every frame differs.
    pub(crate) fn moving(w: u32, h: u32, i: usize) -> Vec<u8> {
        let mut f = vec![255u8; (w * h * 4) as usize];
        for y in 0..h as usize {
            for x in 0..w as usize {
                let o = (y * w as usize + x) * 4;
                f[o] = ((x + i * 7) & 0xff) as u8;
                f[o + 1] = ((y + i * 3) & 0xff) as u8;
                f[o + 2] = (((x ^ y) + i * 5) & 0xff) as u8;
            }
        }
        f
    }

    /// Drives an encoder with `n` moving frames at `fps` and collects the output.
    pub(crate) fn drive(enc: &H264Encoder, out: &Mutex<Vec<EncodedFrame>>, n: usize, fps: u32, key_at: Option<usize>) {
        let (w, h) = (enc.width, enc.height);
        let start = Instant::now();
        for i in 0..n {
            if Some(i) == key_at {
                enc.request_keyframe();
            }
            enc.encode(RawFrame { bgra: moving(w, h, i), width: w, height: h, timestamp_us: (i as u64) * 1_000_000 / fps as u64 });
            if let Some(d) = (start + Duration::from_secs_f64((i + 1) as f64 / fps as f64)).checked_duration_since(Instant::now()) {
                std::thread::sleep(d);
            }
        }
        // Let the last frames drain.
        let deadline = Instant::now() + Duration::from_secs(2);
        while out.lock().unwrap().len() + 2 < n && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Output must decode: an IDR with SPS+PPS first, a forced IDR where asked,
    /// every frame accepted by a real decoder at the encoded size.
    pub(crate) fn assert_stream_decodes(frames: &[EncodedFrame], w: u32, h: u32, forced_after: usize) {
        use openh264::decoder::Decoder;
        use openh264::formats::YUVSource;
        assert!(!frames.is_empty(), "encoder produced nothing");
        let first = nal_types(&frames[0].data);
        assert!(frames[0].key && first.contains(&7) && first.contains(&8) && first.contains(&5), "first frame is not an IDR with SPS/PPS: {first:?}");
        assert!(frames.iter().skip(forced_after).take(10).any(|f| f.key), "no keyframe after the forced request");

        let mut decoder = Decoder::new().unwrap();
        let mut decoded = 0;
        for f in frames {
            if let Ok(Some(pic)) = decoder.decode(&f.data) {
                assert_eq!(pic.dimensions(), (w as usize, h as usize));
                decoded += 1;
            }
        }
        assert!(decoded + 3 >= frames.len(), "decoded {decoded} of {} frames", frames.len());
    }

    #[test]
    fn openh264_stream_decodes_and_honours_keyframe_requests() {
        let out = Arc::new(Mutex::new(Vec::new()));
        let o = out.clone();
        let enc = H264Encoder::open_software(640, 360, 30, 1_000_000, move |f| o.lock().unwrap().push(f)).unwrap();
        drive(&enc, &out, 60, 30, Some(40));
        drop(enc);
        assert_stream_decodes(&out.lock().unwrap(), 640, 360, 40);
    }

    #[test]
    fn bitrate_changes_apply_without_a_restart() {
        let out = Arc::new(Mutex::new(Vec::new()));
        let o = out.clone();
        let enc = H264Encoder::open_software(1280, 720, 30, 4_000_000, move |f| o.lock().unwrap().push(f)).unwrap();
        drive(&enc, &out, 45, 30, None);
        let high: usize = out.lock().unwrap().drain(..).skip(5).map(|f| f.data.len()).sum();
        enc.set_bitrate(MIN_BITRATE);
        drive(&enc, &out, 45, 30, None);
        let low: usize = out.lock().unwrap().drain(..).skip(10).map(|f| f.data.len()).sum();
        // Busy synthetic content bottoms out around half the 4Mbit stream even at
        // QP 51 (measured: 3.9Mbit vs 2.2Mbit); unchanged it stays at ~100%.
        assert!(low * 10 < high * 7, "lower bitrate didn't shrink the stream: {high} → {low} bytes");
        assert!(enc.is_alive());
    }

    #[test]
    fn a_busy_encoder_drops_frames_instead_of_queueing() {
        let enc = H264Encoder::open_software(640, 360, 30, 1_000_000, |_| std::thread::sleep(Duration::from_millis(50))).unwrap();
        for i in 0..10 {
            enc.encode(RawFrame { bgra: moving(640, 360, i), width: 640, height: 360, timestamp_us: 0 });
        }
        assert!(enc.take_stats().busy_drops >= 5);
    }

    #[test]
    fn odd_sizes_are_rejected() {
        assert!(H264Encoder::open_software(641, 360, 30, 1_000_000, |_| {}).is_err());
    }
}
