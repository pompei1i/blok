//! Keeps a screen share within what the sharer's machine and link can carry.
//!
//! The same share has to work on a desktop with a hardware encoder and on a
//! laptop encoding in software while it plays the video being shared, over
//! fibre and over a phone hotspot. Two independent controls, fed once a second:
//!
//! - **CPU**: when the encoder can't keep up (frames dropped because it was
//!   still busy, or encode time eating most of the frame budget), step down a
//!   ladder of (fps, width) — frame rate first, since halving it halves the work
//!   without softening text, then resolution. Step back up only after a long
//!   calm stretch with plenty of headroom, so it doesn't oscillate.
//! - **Network**: congestion (a viewer's send backlog building up) cuts the
//!   bitrate multiplicatively; calm seconds grow it back gradually (AIMD). If
//!   the link stays congested at the bitrate floor, the ladder steps down too:
//!   fewer pixels need fewer bits.
//!
//! Pure logic — no clocks or threads — so the policy is unit-tested directly.

/// One second of measurements from the active encoder and the transport.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct Measurements {
    /// Frames handed to the encoder.
    pub offered: u32,
    /// Frames dropped because the encoder was still busy with the previous one.
    pub dropped: u32,
    /// Mean encode time of the frames that were encoded.
    pub avg_encode_ms: f64,
    /// Congestion events reported by the transport.
    pub congestion: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    Cpu,
    Network,
    Headroom,
}

/// What changed after a tick, for the caller to apply and log.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Change {
    pub fps: u32,
    /// 0 = no cap (native width).
    pub max_width: u32,
    pub bitrate_factor: f64,
    pub reason: Reason,
}

pub const MIN_BITRATE_FACTOR: f64 = 0.2;
/// Consecutive overloaded seconds before stepping down.
const OVERLOAD_SECS: u32 = 2;
/// Consecutive calm seconds before stepping back up.
const CALM_SECS: u32 = 10;
/// Congested seconds at the bitrate floor before the ladder steps down.
const NET_FLOOR_SECS: u32 = 3;
/// Calm seconds before bitrate starts growing back.
const NET_CALM_SECS: u32 = 5;

pub struct ShareAdapter {
    ladder: Vec<(u32, u32)>,
    level: usize,
    /// How many of the steps down were taken for the network. Those come back
    /// on a calm link alone — a static window offers no frames to prove CPU
    /// headroom with, and a share left at 15fps/960px after a blip stayed there.
    net_levels: usize,
    bitrate_factor: f64,
    overload_streak: u32,
    calm_streak: u32,
    net_calm: u32,
    net_floor_streak: u32,
}

/// Widths above `cap` (0 = native, i.e. any) from a fixed set of step-downs.
fn width_steps(cap: u32) -> Vec<u32> {
    let mut steps = vec![cap];
    steps.extend([1920, 1280, 960].into_iter().filter(|&w| cap == 0 || w < cap));
    steps
}

impl ShareAdapter {
    /// `fps` and `max_width` are the user's settings and the top of the ladder.
    pub fn new(fps: u32, max_width: u32) -> Self {
        let fps = fps.clamp(1, 60);
        let widths = width_steps(max_width);
        let reduced = fps.min(30);
        let mut ladder = vec![(fps, widths[0]), (reduced, widths[0])];
        for &w in &widths[1..] {
            ladder.push((reduced, w));
        }
        ladder.push((fps.min(15), *widths.last().unwrap()));
        ladder.dedup();
        ShareAdapter {
            ladder,
            level: 0,
            net_levels: 0,
            bitrate_factor: 1.0,
            overload_streak: 0,
            calm_streak: 0,
            net_calm: 0,
            net_floor_streak: 0,
        }
    }

    pub fn fps(&self) -> u32 {
        self.ladder[self.level].0
    }

    pub fn max_width(&self) -> u32 {
        self.ladder[self.level].1
    }

    pub fn bitrate_factor(&self) -> f64 {
        self.bitrate_factor
    }

    fn budget_ms(fps: u32) -> f64 {
        1000.0 / fps as f64
    }

    /// Relative encode cost of stepping from `from` to `to` on the ladder.
    fn cost_ratio(from: (u32, u32), to: (u32, u32), native_width: u32) -> f64 {
        let width = |w: u32| if w == 0 { native_width.max(1) } else { w.min(native_width.max(1)) } as f64;
        (width(to.1) / width(from.1)).powi(2)
    }

    /// Feeds one second of measurements. `native_width` is the source's width,
    /// to judge what a resolution step really costs.
    pub fn tick(&mut self, m: Measurements, native_width: u32) -> Option<Change> {
        let fps = self.fps();
        let budget = Self::budget_ms(fps);
        let drop_share = if m.offered > 0 { m.dropped as f64 / m.offered as f64 } else { 0.0 };
        let overloaded = drop_share > 0.10 || m.avg_encode_ms > budget * 0.8;
        let mut reason = None;

        // ── network: AIMD on the bitrate, ladder once the floor doesn't help ──
        if m.congestion > 0 {
            self.net_calm = 0;
            if self.bitrate_factor <= MIN_BITRATE_FACTOR {
                self.net_floor_streak += 1;
            }
            let cut = (self.bitrate_factor * 0.7).max(MIN_BITRATE_FACTOR);
            if cut < self.bitrate_factor {
                self.bitrate_factor = cut;
                reason = Some(Reason::Network);
            }
        } else {
            self.net_floor_streak = 0;
            self.net_calm += 1;
            if self.net_calm >= NET_CALM_SECS && self.bitrate_factor < 1.0 {
                self.bitrate_factor = (self.bitrate_factor * 1.1).min(1.0);
                reason = Some(Reason::Headroom);
            }
        }
        if self.net_floor_streak >= NET_FLOOR_SECS && self.level + 1 < self.ladder.len() {
            self.level += 1;
            self.net_levels += 1;
            self.net_floor_streak = 0;
            self.overload_streak = 0;
            self.calm_streak = 0;
            reason = Some(Reason::Network);
        } else if self.net_levels > 0 && self.net_calm >= CALM_SECS && self.bitrate_factor >= 1.0 {
            // The link has been calm long enough for the bitrate to recover
            // fully: undo one network step (a CPU step stays until CPU calms).
            self.level -= 1;
            self.net_levels -= 1;
            self.net_calm = NET_CALM_SECS;
            reason = Some(Reason::Headroom);
        }

        // ── CPU: ladder with hysteresis ──
        if m.offered > 0 {
            if overloaded {
                self.calm_streak = 0;
                self.overload_streak += 1;
                if self.overload_streak >= OVERLOAD_SECS && self.level + 1 < self.ladder.len() {
                    self.level += 1;
                    self.overload_streak = 0;
                    reason = Some(Reason::Cpu);
                }
            } else {
                self.overload_streak = 0;
                // Room to step up: the next level's projected encode time stays
                // well inside its own budget.
                let up = self.level.checked_sub(1).map(|l| self.ladder[l]);
                let fits = up.is_some_and(|up| {
                    let projected = m.avg_encode_ms * Self::cost_ratio(self.ladder[self.level], up, native_width);
                    m.dropped == 0 && projected < Self::budget_ms(up.0) * 0.4
                });
                // Network steps are undone by the network rule above.
                if fits && m.congestion == 0 && self.level > self.net_levels {
                    self.calm_streak += 1;
                    if self.calm_streak >= CALM_SECS {
                        self.level -= 1;
                        self.calm_streak = 0;
                        reason = Some(Reason::Headroom);
                    }
                } else {
                    self.calm_streak = 0;
                }
            }
        }

        reason.map(|reason| Change {
            fps: self.fps(),
            max_width: self.max_width(),
            bitrate_factor: self.bitrate_factor,
            reason,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(offered: u32, dropped: u32, avg_encode_ms: f64, congestion: u32) -> Measurements {
        Measurements { offered, dropped, avg_encode_ms, congestion }
    }

    #[test]
    fn ladder_drops_frame_rate_before_resolution() {
        let a = ShareAdapter::new(60, 0);
        assert_eq!(a.ladder, vec![(60, 0), (30, 0), (30, 1920), (30, 1280), (30, 960), (15, 960)]);
        let a = ShareAdapter::new(30, 1280);
        assert_eq!(a.ladder, vec![(30, 1280), (30, 960), (15, 960)]);
        let a = ShareAdapter::new(15, 960);
        assert_eq!(a.ladder, vec![(15, 960)]);
    }

    #[test]
    fn a_busy_encoder_steps_down_after_sustained_overload_only() {
        let mut a = ShareAdapter::new(60, 1920);
        assert_eq!(a.tick(m(60, 20, 15.0, 0), 1920), None, "one bad second is noise");
        let c = a.tick(m(60, 20, 15.0, 0), 1920).expect("second bad second steps down");
        assert_eq!((c.fps, c.max_width, c.reason), (30, 1920, Reason::Cpu));
        // Slow encodes without drops also count once they eat the budget.
        a.tick(m(30, 0, 30.0, 0), 1920);
        let c = a.tick(m(30, 0, 30.0, 0), 1920).unwrap();
        assert_eq!((c.fps, c.max_width), (30, 1280));
    }

    #[test]
    fn steps_back_up_only_after_a_calm_stretch_with_real_headroom() {
        let mut a = ShareAdapter::new(60, 1920);
        a.tick(m(60, 30, 20.0, 0), 1920);
        a.tick(m(60, 30, 20.0, 0), 1920);
        assert_eq!(a.fps(), 30);

        // 5ms at 30fps projects to 5ms at 60fps: 30% of a 16.7ms budget → fits.
        for i in 0..CALM_SECS - 1 {
            assert_eq!(a.tick(m(30, 0, 5.0, 0), 1920), None, "stepped up early at {i}s");
        }
        let c = a.tick(m(30, 0, 5.0, 0), 1920).unwrap();
        assert_eq!((c.fps, c.reason), (60, Reason::Headroom));

        // Without headroom it stays put indefinitely.
        let mut b = ShareAdapter::new(60, 1920);
        b.tick(m(60, 30, 20.0, 0), 1920);
        b.tick(m(60, 30, 20.0, 0), 1920);
        for _ in 0..30 {
            b.tick(m(30, 0, 12.0, 0), 1920);
        }
        assert_eq!(b.fps(), 30);
    }

    #[test]
    fn resolution_step_up_accounts_for_the_bigger_frames() {
        let mut a = ShareAdapter::new(30, 1920);
        for _ in 0..2 {
            a.tick(m(30, 10, 40.0, 0), 1920);
        }
        assert_eq!(a.max_width(), 1280);
        // 6.5ms at 1280 is ~14.6ms at 1920: 44% of 33ms — too tight to step up.
        for _ in 0..30 {
            a.tick(m(30, 0, 6.5, 0), 1920);
        }
        assert_eq!(a.max_width(), 1280);
        // 3ms projects to ~6.8ms: fits.
        for _ in 0..CALM_SECS {
            a.tick(m(30, 0, 3.0, 0), 1920);
        }
        assert_eq!(a.max_width(), 1920);
    }

    #[test]
    fn congestion_cuts_bitrate_and_calm_grows_it_back() {
        let mut a = ShareAdapter::new(30, 1920);
        let c = a.tick(m(30, 0, 3.0, 2), 1920).unwrap();
        assert_eq!(c.reason, Reason::Network);
        assert!((c.bitrate_factor - 0.7).abs() < 1e-9);
        a.tick(m(30, 0, 3.0, 1), 1920);
        assert!((a.bitrate_factor() - 0.49).abs() < 1e-9);

        for _ in 0..NET_CALM_SECS - 1 {
            a.tick(m(30, 0, 3.0, 0), 1920);
        }
        assert!((a.bitrate_factor() - 0.49).abs() < 1e-9, "grew back before the calm period");
        let c = a.tick(m(30, 0, 3.0, 0), 1920).unwrap();
        assert_eq!(c.reason, Reason::Headroom);
        assert!(c.bitrate_factor > 0.49);
        for _ in 0..60 {
            a.tick(m(30, 0, 3.0, 0), 1920);
        }
        assert_eq!(a.bitrate_factor(), 1.0);
    }

    #[test]
    fn persistent_congestion_at_the_floor_steps_the_ladder_down() {
        let mut a = ShareAdapter::new(30, 1920);
        let mut secs = 0;
        while a.bitrate_factor() > MIN_BITRATE_FACTOR {
            a.tick(m(30, 0, 3.0, 5), 1920);
            secs += 1;
        }
        assert_eq!(a.max_width(), 1920, "stepped down before reaching the bitrate floor");
        for _ in 0..NET_FLOOR_SECS {
            a.tick(m(30, 0, 3.0, 5), 1920);
        }
        assert_eq!(a.max_width(), 1280, "still at full resolution after {secs}s + floor");
    }

    #[test]
    fn network_steps_come_back_on_a_calm_link_even_with_a_static_source() {
        let mut a = ShareAdapter::new(60, 1920);
        while a.bitrate_factor() > MIN_BITRATE_FACTOR {
            a.tick(m(60, 0, 3.0, 5), 1920);
        }
        for _ in 0..NET_FLOOR_SECS * 2 {
            a.tick(m(60, 0, 3.0, 5), 1920);
        }
        let stepped = a.level;
        assert!(stepped >= 2, "network congestion didn't step down");

        // A static window: no frames offered at all, link calm.
        for _ in 0..600 {
            a.tick(Measurements::default(), 1920);
        }
        assert_eq!((a.fps(), a.max_width(), a.bitrate_factor()), (60, 1920, 1.0), "stuck at level {}", a.level);
    }

    #[test]
    fn cpu_steps_are_not_undone_by_a_calm_link() {
        let mut a = ShareAdapter::new(60, 1920);
        a.tick(m(60, 30, 20.0, 0), 1920);
        a.tick(m(60, 30, 20.0, 0), 1920);
        assert_eq!(a.fps(), 30);
        for _ in 0..120 {
            a.tick(m(30, 0, 14.0, 0), 1920); // calm network, no CPU headroom
        }
        assert_eq!(a.fps(), 30);
    }

    #[test]
    fn an_idle_screen_changes_nothing() {
        let mut a = ShareAdapter::new(60, 1920);
        for _ in 0..60 {
            assert_eq!(a.tick(Measurements::default(), 1920), None);
        }
        assert_eq!((a.fps(), a.max_width()), (60, 1920));
    }
}
