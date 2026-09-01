//! Windows monitor capture via DXGI Desktop Duplication.
//!
//! The GDI path (`BitBlt` from the screen DC + `GetDIBits`) measures ~25-32ms per
//! 1080p frame on a DWM-composited desktop — a hard ~30fps ceiling before a single
//! byte is encoded, so a 60fps setting could never be honoured. Desktop Duplication
//! reads the already-composited frame straight off the GPU: ~2-4ms for the same
//! frame, and it *blocks* until the desktop actually changes, which replaces the
//! frame-hash dedup with a free, exact "nothing moved" signal.
//!
//! Only whole monitors are duplicable; window capture stays on GDI (see `lib.rs`),
//! as does any machine where duplication is unavailable (some RDP sessions, older
//! drivers) — `Capturer::new` falls back on its own.

use windows::core::Interface;
use windows::Win32::Foundation::{HANDLE, HMODULE, RECT};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_0};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
    D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE,
    D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput1, IDXGIOutputDuplication,
    IDXGIResource, DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO,
};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ,
};

/// What one `Duplicator::grab` attempt produced.
pub enum Grab<'a> {
    /// A fresh BGRA frame (cursor already composited in), tightly packed.
    Frame(&'a [u8], u32, u32),
    /// The desktop didn't change within the timeout — nothing to encode.
    Unchanged,
    /// Duplication broke (resolution change, UAC/secure desktop, driver reset).
    /// The caller re-creates the duplicator, or falls back to GDI.
    Lost,
}

/// A GDI DIB section used purely as a CPU-side scratch surface: the duplicated
/// frame is copied into its pixel memory, then `DrawIconEx` paints the cursor
/// directly into those same bytes (Desktop Duplication delivers the desktop
/// *without* the pointer, exactly like `BitBlt` does).
struct DibSurface {
    hdc: HDC,
    bmp: HBITMAP,
    bits: *mut u8,
    w: u32,
    h: u32,
}

impl DibSurface {
    fn new(w: u32, h: u32) -> Option<Self> {
        unsafe {
            let mut bmi = core::mem::zeroed::<BITMAPINFO>();
            bmi.bmiHeader.biSize = core::mem::size_of::<BITMAPINFOHEADER>() as u32;
            bmi.bmiHeader.biWidth = w as i32;
            bmi.bmiHeader.biHeight = -(h as i32); // top-down
            bmi.bmiHeader.biPlanes = 1;
            bmi.bmiHeader.biBitCount = 32;
            bmi.bmiHeader.biCompression = 0u32; // BI_RGB

            let hdc = CreateCompatibleDC(None);
            if hdc.is_invalid() {
                return None;
            }
            let mut bits: *mut core::ffi::c_void = core::ptr::null_mut();
            let bmp = match CreateDIBSection(
                Some(hdc),
                &bmi,
                DIB_RGB_COLORS,
                &mut bits,
                Some(HANDLE::default()),
                0,
            ) {
                Ok(b) if !bits.is_null() => b,
                _ => {
                    let _ = DeleteDC(hdc);
                    return None;
                }
            };
            SelectObject(hdc, HGDIOBJ(bmp.0));
            Some(DibSurface { hdc, bmp, bits: bits.cast(), w, h })
        }
    }

    fn pixels_mut(&mut self) -> &mut [u8] {
        unsafe { core::slice::from_raw_parts_mut(self.bits, (self.w * self.h * 4) as usize) }
    }

    fn pixels(&self) -> &[u8] {
        unsafe { core::slice::from_raw_parts(self.bits, (self.w * self.h * 4) as usize) }
    }
}

impl Drop for DibSurface {
    fn drop(&mut self) {
        unsafe {
            let _ = DeleteObject(HGDIOBJ(self.bmp.0));
            let _ = DeleteDC(self.hdc);
        }
    }
}

/// Desktop Duplication for one monitor. Single-threaded by construction: the
/// D3D11 immediate context and the duplication object both belong to the capture
/// thread that created them.
pub struct Duplicator {
    device: ID3D11Device,
    ctx: ID3D11DeviceContext,
    dupl: IDXGIOutputDuplication,
    /// CPU-readable staging texture, recreated whenever the frame size changes.
    staging: Option<(ID3D11Texture2D, u32, u32)>,
    surface: Option<DibSurface>,
    /// Monitor origin in virtual-desktop coordinates, for placing the cursor.
    origin: (i32, i32),
    /// The monitor rect this duplicator was built for, so it can rebuild itself
    /// after DXGI_ERROR_ACCESS_LOST without re-resolving the index.
    rect: RECT,
    /// Cost of the last successful grab *excluding* the wait for the desktop to
    /// change — i.e. the CPU/GPU work a frame actually costs. Feeds the
    /// `[screencast]` throughput log, where a wall-clock timing would just report
    /// how idle the screen was.
    pub last_work: std::time::Duration,
}

impl Duplicator {
    /// Builds a duplicator for the output whose desktop rect matches `rect`.
    /// Returns `None` when duplication is unavailable — the caller uses GDI.
    pub fn new(rect: RECT) -> Option<Self> {
        unsafe {
            let factory: IDXGIFactory1 = CreateDXGIFactory1().ok()?;
            let mut adapter_idx = 0u32;
            while let Ok(adapter) = factory.EnumAdapters1(adapter_idx) {
                adapter_idx += 1;
                let mut out_idx = 0u32;
                while let Ok(output) = adapter.EnumOutputs(out_idx) {
                    out_idx += 1;
                    let Ok(desc) = output.GetDesc() else { continue };
                    let c = desc.DesktopCoordinates;
                    if c.left != rect.left || c.top != rect.top
                        || c.right != rect.right || c.bottom != rect.bottom
                    {
                        continue;
                    }
                    let Some((device, ctx)) = create_device(&adapter) else { continue };
                    let Ok(output1) = output.cast::<IDXGIOutput1>() else { continue };
                    // Changing quality/fps mid-share restarts capture, and the
                    // outgoing generation may still hold its duplication for up to
                    // one acquire timeout. Retrying briefly keeps that overlap from
                    // silently demoting the share to the (3x slower) GDI path.
                    let mut dupl = None;
                    for attempt in 0..5 {
                        match output1.DuplicateOutput(&device) {
                            Ok(d) => {
                                dupl = Some(d);
                                break;
                            }
                            Err(_) if attempt < 4 => {
                                std::thread::sleep(std::time::Duration::from_millis(50))
                            }
                            Err(_) => break,
                        }
                    }
                    let Some(dupl) = dupl else { continue };
                    return Some(Duplicator {
                        device,
                        ctx,
                        dupl,
                        staging: None,
                        surface: None,
                        origin: (rect.left, rect.top),
                        rect,
                        last_work: std::time::Duration::ZERO,
                    });
                }
            }
            None
        }
    }

    /// Rebuilds the duplication object in place after an access loss, keeping the
    /// D3D device. Returns false when it still can't be re-acquired (e.g. the
    /// secure desktop is up) — the caller retries on a later frame.
    pub fn reacquire(&mut self) -> bool {
        unsafe {
            let Ok(dxgi_dev) = self.device.cast::<windows::Win32::Graphics::Dxgi::IDXGIDevice>()
            else {
                return false;
            };
            let Ok(adapter) = dxgi_dev.GetAdapter() else { return false };
            let mut out_idx = 0u32;
            while let Ok(output) = adapter.EnumOutputs(out_idx) {
                out_idx += 1;
                let Ok(desc) = output.GetDesc() else { continue };
                let c = desc.DesktopCoordinates;
                if c.left != self.rect.left || c.top != self.rect.top
                    || c.right != self.rect.right || c.bottom != self.rect.bottom
                {
                    continue;
                }
                let Ok(output1) = output.cast::<IDXGIOutput1>() else { continue };
                if let Ok(dupl) = output1.DuplicateOutput(&self.device) {
                    self.dupl = dupl;
                    self.staging = None;
                    return true;
                }
            }
            false
        }
    }

    /// Waits up to `timeout_ms` for the desktop to change, then returns the frame
    /// with the cursor drawn in. The slice borrows the internal surface and stays
    /// valid until the next `grab`.
    pub fn grab(&mut self, timeout_ms: u32) -> Grab<'_> {
        unsafe {
            let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
            let mut resource: Option<IDXGIResource> = None;
            if let Err(e) = self.dupl.AcquireNextFrame(timeout_ms, &mut info, &mut resource) {
                return if e.code() == DXGI_ERROR_WAIT_TIMEOUT {
                    Grab::Unchanged
                } else {
                    Grab::Lost
                };
            }
            // Everything past the acquire is real work; the wait above is just the
            // desktop being idle and must not count towards the capture cost.
            let work_started = std::time::Instant::now();
            let acquired = resource.and_then(|r| r.cast::<ID3D11Texture2D>().ok());
            let Some(tex) = acquired else {
                let _ = self.dupl.ReleaseFrame();
                return Grab::Lost;
            };

            let mut desc = D3D11_TEXTURE2D_DESC::default();
            tex.GetDesc(&mut desc);
            let (w, h) = (desc.Width, desc.Height);

            if !matches!(self.staging, Some((_, sw, sh)) if sw == w && sh == h) {
                self.staging = make_staging(&self.device, w, h).map(|t| (t, w, h));
                self.surface = DibSurface::new(w, h);
            }
            let (Some((staging, _, _)), Some(_)) = (self.staging.as_ref(), self.surface.as_ref())
            else {
                let _ = self.dupl.ReleaseFrame();
                return Grab::Lost;
            };

            self.ctx.CopyResource(staging, &tex);
            // Release as early as possible: while a frame is held, the compositor
            // can't hand us the next one.
            let _ = self.dupl.ReleaseFrame();

            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            if self.ctx.Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).is_err() {
                return Grab::Lost;
            }
            let surface = self.surface.as_mut().expect("checked above");
            let row_bytes = (w * 4) as usize;
            let pitch = mapped.RowPitch as usize;
            let src = core::slice::from_raw_parts(mapped.pData as *const u8, pitch * h as usize);
            let dst = surface.pixels_mut();
            if pitch == row_bytes {
                dst.copy_from_slice(&src[..row_bytes * h as usize]);
            } else {
                // Padded rows: GPU pitch is aligned, our buffer is tightly packed.
                for y in 0..h as usize {
                    dst[y * row_bytes..(y + 1) * row_bytes]
                        .copy_from_slice(&src[y * pitch..y * pitch + row_bytes]);
                }
            }
            self.ctx.Unmap(staging, 0);

            crate::win_draw_cursor(surface.hdc, self.origin.0, self.origin.1);
            self.last_work = work_started.elapsed();
            Grab::Frame(self.surface.as_ref().expect("checked above").pixels(), w, h)
        }
    }
}

fn create_device(adapter: &IDXGIAdapter1) -> Option<(ID3D11Device, ID3D11DeviceContext)> {
    unsafe {
        let mut device: Option<ID3D11Device> = None;
        let mut ctx: Option<ID3D11DeviceContext> = None;
        // D3D_DRIVER_TYPE_UNKNOWN is mandatory when an explicit adapter is passed.
        D3D11CreateDevice(
            adapter,
            D3D_DRIVER_TYPE_UNKNOWN,
            HMODULE::default(),
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

/// Marks the loss reason so the caller can tell "retry duplication" apart from
/// "this monitor index doesn't exist".
pub fn monitor_rect(index: u32) -> Option<RECT> {
    crate::win_monitor_rects().get(index as usize).copied()
}
