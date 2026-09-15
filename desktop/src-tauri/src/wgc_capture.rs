//! Windows single-window capture via Windows.Graphics.Capture (WGC).
//!
//! The GDI path (`GetDC(hwnd)` + `BitBlt`) does not capture a window's content on
//! a composited desktop: anything drawn by the GPU — browsers, Electron apps,
//! games — hands back a black, never-changing surface. Measured on this machine,
//! Zen Browser and Program Manager came back 100% black with a single distinct
//! colour, byte-identical 250ms apart. The frame-hash dedup then suppresses every
//! frame, so a viewer sees a black or frozen share rather than a slow one.
//!
//! WGC asks DWM for the window's own composited content, which is why it works
//! for occluded and GPU-rendered windows alike, and it delivers on the GPU at the
//! same cost class as Desktop Duplication. Requires Windows 10 1903+; older
//! systems fall back to the GDI path in `lib.rs`.

use windows::core::{IInspectable, Interface};
use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::{
    Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
};
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_11_0};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_CPU_ACCESS_READ,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Number of surfaces in the frame pool. Two is enough for a "newest frame wins"
/// consumer: one being read while the compositor fills the other.
const POOL_SIZE: i32 = 2;

/// A live WGC session for one window, plus the CPU-side buffer its frames land in.
pub struct WindowCapture {
    device: ID3D11Device,
    ctx: ID3D11DeviceContext,
    pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    item: GraphicsCaptureItem,
    /// Set by the pool's Arrived handler; lets `grab` wait for a frame instead of
    /// spinning on TryGetNextFrame, which returns null between compositions.
    arrived: Arc<AtomicBool>,
    staging: Option<(ID3D11Texture2D, u32, u32)>,
    /// Tightly-packed BGRA, reused across frames.
    buf: Vec<u8>,
    size: (u32, u32),
    /// Work (not wait) cost of the last successful grab, for the throughput log.
    pub last_work: std::time::Duration,
}

impl WindowCapture {
    /// Starts capturing `hwnd`. `None` when WGC is unavailable (pre-1903, or the
    /// window can't be captured) — the caller falls back to GDI.
    pub fn new(hwnd: isize) -> Option<Self> {
        unsafe {
            let hwnd = HWND(hwnd as *mut _);
            let interop: IGraphicsCaptureItemInterop =
                windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().ok()?;
            let item: GraphicsCaptureItem = interop.CreateForWindow(hwnd).ok()?;
            let size = item.Size().ok()?;
            if size.Width <= 0 || size.Height <= 0 {
                return None;
            }

            let (device, ctx) = create_device()?;
            let dxgi: IDXGIDevice = device.cast().ok()?;
            let inspectable: IInspectable = CreateDirect3D11DeviceFromDXGIDevice(&dxgi).ok()?;
            let d3d_device: IDirect3DDevice = inspectable.cast().ok()?;

            let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
                &d3d_device,
                DirectXPixelFormat::B8G8R8A8UIntNormalized,
                POOL_SIZE,
                size,
            )
            .ok()?;

            let arrived = Arc::new(AtomicBool::new(false));
            let flag = arrived.clone();
            pool.FrameArrived(&TypedEventHandler::new(
                move |_pool: windows::core::Ref<'_, Direct3D11CaptureFramePool>, _: windows::core::Ref<'_, IInspectable>| {
                    flag.store(true, Ordering::SeqCst);
                    Ok(())
                },
            ))
            .ok()?;

            let session = pool.CreateCaptureSession(&item).ok()?;
            // The yellow "you are being captured" border is on by default and would
            // be burned into every frame the viewer sees. Only settable on Win11
            // 22000+; ignoring the error just keeps the border on older builds.
            let _ = session.SetIsBorderRequired(false);
            // The cursor belongs to the desktop, not the window, and `lib.rs` draws
            // it for the monitor path only — keep window shares consistent with it.
            let _ = session.SetIsCursorCaptureEnabled(false);
            // The default minimum interval is 16ms, and frames only land on vsync,
            // so on a 144Hz display the next vsync past 16ms is three away: 48fps,
            // measured, for a window redrawing every frame. The capture loop does
            // its own pacing, so let DWM deliver every composition. Win11 24H2+;
            // older builds keep their default.
            let _ = session.SetMinUpdateInterval(windows::Foundation::TimeSpan { Duration: 10_000 });
            session.StartCapture().ok()?;

            Some(WindowCapture {
                device,
                ctx,
                pool,
                session,
                item,
                arrived,
                staging: None,
                buf: Vec::new(),
                size: (size.Width as u32, size.Height as u32),
                last_work: std::time::Duration::ZERO,
            })
        }
    }

    /// Waits up to `timeout_ms` for the window to compose a new frame, then copies
    /// it out as tightly-packed BGRA. `None` means nothing new within the timeout.
    pub fn grab(&mut self, timeout_ms: u32) -> Option<(&[u8], u32, u32)> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms as u64);
        loop {
            if self.arrived.swap(false, Ordering::SeqCst) {
                break;
            }
            if std::time::Instant::now() >= deadline {
                return None;
            }
            // The pool signals from a compositor thread; a short park keeps the
            // capture thread off a spin loop without adding meaningful latency.
            std::thread::sleep(std::time::Duration::from_millis(1));
        }

        let started = std::time::Instant::now();
        unsafe {
            // Take the newest frame: with the pool fed at the display rate, the
            // oldest one can be a composition or two stale by now.
            let mut frame = self.pool.TryGetNextFrame().ok()?;
            while let Ok(newer) = self.pool.TryGetNextFrame() {
                frame = newer;
            }
            let content = frame.ContentSize().ok()?;
            let surface = frame.Surface().ok()?;
            let access: IDirect3DDxgiInterfaceAccess = surface.cast().ok()?;
            let tex: ID3D11Texture2D = access.GetInterface().ok()?;

            let mut desc = D3D11_TEXTURE2D_DESC::default();
            tex.GetDesc(&mut desc);
            let (tw, th) = (desc.Width, desc.Height);

            // Surfaces stay at the size the pool was made with; a resized window
            // only shows in ContentSize. Recreate the pool for the next frames, and
            // meanwhile send the part of this surface the content occupies — a
            // window being dragged larger stays live instead of freezing.
            let (cw, ch) = (content.Width.max(0) as u32, content.Height.max(0) as u32);
            if cw == 0 || ch == 0 {
                return None; // minimized
            }
            if (cw, ch) != self.size {
                self.size = (cw, ch);
                let _ = self.recreate_pool(cw, ch);
            }
            let (w, h) = (cw.min(tw), ch.min(th));

            if !matches!(self.staging, Some((_, sw, sh)) if sw == tw && sh == th) {
                self.staging = make_staging(&self.device, tw, th).map(|t| (t, tw, th));
            }
            let (staging, _, _) = self.staging.as_ref()?;
            let row = (w * 4) as usize;
            self.buf.resize(row * h as usize, 0);

            self.ctx.CopyResource(staging, &tex);
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            self.ctx.Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).ok()?;
            let pitch = mapped.RowPitch as usize;
            let src = core::slice::from_raw_parts(mapped.pData as *const u8, pitch * th as usize);
            for y in 0..h as usize {
                self.buf[y * row..(y + 1) * row].copy_from_slice(&src[y * pitch..y * pitch + row]);
            }
            self.ctx.Unmap(staging, 0);

            self.last_work = started.elapsed();
            Some((&self.buf, w, h))
        }
    }

    /// Repoints the pool at a new frame size after the window was resized.
    fn recreate_pool(&mut self, w: u32, h: u32) -> Option<()> {
        unsafe {
            let dxgi: IDXGIDevice = self.device.cast().ok()?;
            let inspectable: IInspectable = CreateDirect3D11DeviceFromDXGIDevice(&dxgi).ok()?;
            let d3d_device: IDirect3DDevice = inspectable.cast().ok()?;
            self.pool
                .Recreate(
                    &d3d_device,
                    DirectXPixelFormat::B8G8R8A8UIntNormalized,
                    POOL_SIZE,
                    SizeInt32 { Width: w as i32, Height: h as i32 },
                )
                .ok()?;
            Some(())
        }
    }
}

impl Drop for WindowCapture {
    fn drop(&mut self) {
        // Closing the session stops DWM feeding the pool; without it the capture
        // keeps running for the life of the process.
        let _ = self.session.Close();
        let _ = self.pool.Close();
        let _ = &self.item;
    }
}

fn create_device() -> Option<(ID3D11Device, ID3D11DeviceContext)> {
    unsafe {
        let mut device: Option<ID3D11Device> = None;
        let mut ctx: Option<ID3D11DeviceContext> = None;
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            windows::Win32::Foundation::HMODULE::default(),
            // BGRA support is required for WGC's B8G8R8A8 surfaces.
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            Some(&[D3D_FEATURE_LEVEL_11_0]),
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut ctx),
        )
        .ok()?;
        Some((device?, ctx?))
    }
}

fn make_staging(device: &ID3D11Device, w: u32, h: u32) -> Option<ID3D11Texture2D> {
    unsafe {
        let desc = D3D11_TEXTURE2D_DESC {
            Width: w,
            Height: h,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };
        let mut tex: Option<ID3D11Texture2D> = None;
        device.CreateTexture2D(&desc, None, Some(&mut tex)).ok()?;
        tex
    }
}

/// Whether WGC is present at all (Windows 10 1903+). Checked once so a failure to
/// create a session for one window doesn't get mistaken for an unsupported OS.
pub fn is_supported() -> bool {
    GraphicsCaptureSession::IsSupported().unwrap_or(false)
}

/// A real top-level window, repainted continuously from its own thread so DWM
/// composes a new frame on every vsync. For capture tests only.
#[cfg(test)]
pub(crate) struct TestWindow {
    hwnd: isize,
    stop: Arc<AtomicBool>,
}

#[cfg(test)]
impl TestWindow {
    pub(crate) fn new() -> Self {
        use windows::Win32::Foundation::{COLORREF, RECT};
        use windows::Win32::Graphics::Gdi::{CreateSolidBrush, DeleteObject, FillRect, GetDC, ReleaseDC};
        use windows::Win32::UI::WindowsAndMessaging::*;

        let stop = Arc::new(AtomicBool::new(false));
        let (tx, rx) = std::sync::mpsc::channel();
        let s = stop.clone();
        std::thread::spawn(move || unsafe {
            // The window lives on this thread: it must pump its own messages.
            let win = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                windows::core::w!("STATIC"),
                windows::core::w!("blok capture test"),
                WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                100, 100, 640, 480,
                None, None, None, None,
            )
            .expect("create test window");
            tx.send(win.0 as isize).unwrap();
            let mut msg = MSG::default();
            let mut colour = 0u32;
            while !s.load(Ordering::SeqCst) {
                while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                    DispatchMessageW(&msg);
                }
                colour = colour.wrapping_add(0x010203);
                let dc = GetDC(Some(win));
                let brush = CreateSolidBrush(COLORREF(colour & 0xffffff));
                FillRect(dc, &RECT { left: 0, top: 0, right: 8000, bottom: 8000 }, brush);
                let _ = DeleteObject(brush.into());
                ReleaseDC(Some(win), dc);
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
            let _ = DestroyWindow(win);
        });
        let hwnd = rx.recv().expect("test window thread");
        std::thread::sleep(std::time::Duration::from_millis(300)); // first composition
        TestWindow { hwnd, stop }
    }

    pub(crate) fn hwnd(&self) -> isize {
        self.hwnd
    }

    pub(crate) fn resize(&self, w: i32, h: i32) {
        use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};
        unsafe {
            let _ = SetWindowPos(HWND(self.hwnd as *mut _), None, 100, 100, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
        }
    }
}

#[cfg(test)]
impl Drop for TestWindow {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    /// Newest frame size seen within `dur`.
    fn size_after(cap: &mut WindowCapture, dur: Duration) -> Option<(u32, u32)> {
        let end = Instant::now() + dur;
        let mut last = None;
        while Instant::now() < end {
            if let Some((px, w, h)) = cap.grab(100) {
                assert_eq!(px.len(), (w * h * 4) as usize, "frame is not tightly packed BGRA");
                last = Some((w, h));
            }
        }
        last
    }

    /// The regression: frames kept the size the share started with, so a grown
    /// window was cut off and a shrunk one padded with stale pixels.
    #[test]
    fn frames_follow_a_resized_window() {
        if !is_supported() {
            return;
        }
        let win = TestWindow::new();
        let Some(mut cap) = WindowCapture::new(win.hwnd()) else { return };
        let (w0, h0) = size_after(&mut cap, Duration::from_millis(300)).expect("frames before resize");

        win.resize(1100, 800);
        let (w1, h1) = size_after(&mut cap, Duration::from_millis(500)).expect("frames after growing");
        assert!(w1 > w0 + 300 && h1 > h0 + 200, "grown window still captured at {w1}x{h1} (was {w0}x{h0})");

        win.resize(400, 300);
        let (w2, h2) = size_after(&mut cap, Duration::from_millis(500)).expect("frames after shrinking");
        assert!(w2 < w0 && h2 < h0, "shrunk window still captured at {w2}x{h2} (was {w0}x{h0})");
    }

    /// The default 16ms minimum interval capped a 144Hz display at 48fps.
    #[test]
    fn session_does_not_throttle_below_the_display_rate() {
        if !is_supported() {
            return;
        }
        let win = TestWindow::new();
        let Some(cap) = WindowCapture::new(win.hwnd()) else { return };
        // Pre-24H2 builds lack the property; nothing to check there.
        if let Ok(interval) = cap.session.MinUpdateInterval() {
            assert!(interval.Duration <= 10_000, "min update interval is {}hns", interval.Duration);
        }
    }

    /// Picking the same window again starts a second session while the first is
    /// still alive; the new one must keep delivering after the old one closes.
    #[test]
    fn a_second_session_on_the_same_window_survives_the_first_closing() {
        if !is_supported() {
            return;
        }
        let win = TestWindow::new();
        let Some(first) = WindowCapture::new(win.hwnd()) else { return };
        let mut second = WindowCapture::new(win.hwnd()).expect("second session on the same window");
        std::thread::spawn(move || drop(first)).join().unwrap();
        assert!(size_after(&mut second, Duration::from_millis(300)).is_some());
    }
}
