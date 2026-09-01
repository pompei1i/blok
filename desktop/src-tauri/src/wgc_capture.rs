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
            let frame = self.pool.TryGetNextFrame().ok()?;
            let surface = frame.Surface().ok()?;
            let access: IDirect3DDxgiInterfaceAccess = surface.cast().ok()?;
            let tex: ID3D11Texture2D = access.GetInterface().ok()?;

            let mut desc = D3D11_TEXTURE2D_DESC::default();
            tex.GetDesc(&mut desc);
            let (w, h) = (desc.Width, desc.Height);

            // A resized window changes the frame size; the pool must be told or it
            // keeps handing back the old dimensions.
            if (w, h) != self.size {
                self.size = (w, h);
                self.staging = None;
                let _ = self.recreate_pool(w, h);
            }
            if !matches!(self.staging, Some((_, sw, sh)) if sw == w && sh == h) {
                self.staging = make_staging(&self.device, w, h).map(|t| (t, w, h));
                self.buf = vec![0u8; (w * h * 4) as usize];
            }
            let (staging, _, _) = self.staging.as_ref()?;

            self.ctx.CopyResource(staging, &tex);
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            self.ctx.Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).ok()?;
            let row = (w * 4) as usize;
            let pitch = mapped.RowPitch as usize;
            let src = core::slice::from_raw_parts(mapped.pData as *const u8, pitch * h as usize);
            if pitch == row {
                self.buf.copy_from_slice(&src[..row * h as usize]);
            } else {
                for y in 0..h as usize {
                    self.buf[y * row..(y + 1) * row]
                        .copy_from_slice(&src[y * pitch..y * pitch + row]);
                }
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
