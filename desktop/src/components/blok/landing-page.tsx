const LOGO = `
██████╗ ██╗      ██████╗ ██╗  ██╗
██╔══██╗██║     ██╔═══██╗██║ ██╔╝
██████╔╝██║     ██║   ██║█████╔╝
██╔══██╗██║     ██║   ██║██╔═██╗
██████╔╝███████╗╚██████╔╝██║  ██╗
╚═════╝ ╚══════╝ ╚═════╝ ╚═╝  ╚═╝`.trim();

const FEATURES: { cmd: string; title: string; desc: string }[] = [
  { cmd: 'text',   title: 'Text Channels',     desc: 'Realtime messaging with markdown, replies, reactions, pins, polls, and announcements.' },
  { cmd: 'voice',  title: 'Native Voice',      desc: 'cpal Rust audio engine. WebRTC fallback. Noise suppression, echo cancel, PTT.' },
  { cmd: 'screen', title: 'Screen Share',      desc: 'GDI native picker. Configurable FPS (1–30), resolution (720p→native), JPEG quality.' },
  { cmd: 'ai',     title: 'b.ai.t',            desc: 'Built-in AI assistant powered by Claude. Per-channel context, command-style interface.' },
  { cmd: 'roles',  title: 'Roles & Perms',     desc: 'Bitfield role system. Owner-only manager. Granular permissions per channel.' },
  { cmd: 'dm',     title: 'Friends & DMs',     desc: 'Friend requests, floating DM popups with drag + minimize, unread counters.' },
  { cmd: 'search', title: 'In-Channel Search', desc: 'Ctrl+F debounced ILIKE query. ↑↓ navigation, jump-to-message.' },
  { cmd: 'i18n',   title: '6 Languages',       desc: 'EN · RU · UA · PL · DE · ES — 165+ translation keys. Runtime switch.' },
];

const STACK = [
  'Tauri 2', 'Rust', 'cpal', 'React 19', 'TypeScript 5',
  'Vite 7', 'Tailwind 4', 'Zustand 4', 'Supabase',
  'WebRTC', 'DOMPurify', 'NSIS', 'IBM Plex Mono',
];

interface Props {
  onSignIn: () => void;
}

export function LandingPage({ onSignIn }: Props) {
  return (
    <div style={s.root}>
      <style>{`
        @media (max-width: 560px) {
          .blok-lp-grid { grid-template-columns: 1fr !important; }
          .blok-lp-logo { font-size: clamp(5px, 2.2vw, 8px) !important; }
        }
        .blok-lp-btn:hover { background: #111 !important; border-color: #666 !important; color: #fff !important; }
        .blok-lp-nav-a:hover { color: #aaa !important; }
      `}</style>

      {/* grid overlay */}
      <div style={s.grid} aria-hidden />

      <div style={s.col}>

        {/* ── NAV ── */}
        <nav style={s.nav}>
          <span style={s.navBrand}>$blok</span>
          <span style={s.navMeta}>v0.9.0 · windows/x64</span>
          <div style={s.navLinks}>
            <NavA href="#">github</NavA>
            <NavA href="#">releases</NavA>
          </div>
        </nav>
        <div style={s.navRule} />

        {/* ── HERO ── */}
        <header style={{ marginBottom: 64 }}>
          <pre style={s.logo} className="blok-lp-logo">{LOGO}</pre>

          <div style={s.badges}>
            <Badge>v0.9.0</Badge>
            <Dot />
            <Badge>stable</Badge>
            <Dot />
            <Badge>windows / x64</Badge>
            <Dot />
            <Badge>tauri 2</Badge>
          </div>

          <p style={s.tagline}><Dim># </Dim>native desktop communication — channels, voice, screen share, AI.</p>
          <p style={{ ...s.tagline, marginTop: 4 }}><Dim># </Dim>no electron. no browser tab. pure desktop.</p>
        </header>

        <Rule />

        {/* ── ABOUT ── */}
        <Section path="~/project/about.txt" mb={48}>
          <div style={s.codeBlock}>
            <CL prompt>cat about.txt</CL>
            <div style={{ height: 10 }} />
            <CL>Blok is an open-source desktop messenger built for developers.</CL>
            <CL>Servers, text channels, native voice, screen share, polls,</CL>
            <CL>reactions, roles, and a built-in AI assistant — all in a</CL>
            <CL>single Tauri 2 window backed by a Rust audio engine.</CL>
            <div style={{ height: 8 }} />
            <CL comment>{'// self-hostable · supabase backend · rls on every table'}</CL>
          </div>
        </Section>

        <Rule />

        {/* ── SIGN IN ── */}
        <Section path="~/project/session.sh" mb={48}>
          <div style={s.codeBlock}>
            <CL prompt>{'# authenticate with your blok account'}</CL>
            <CL>blok auth login</CL>
            <div style={{ height: 8 }} />
            <CL comment>{'// supabase auth — email + password or oauth'}</CL>
          </div>
          <div style={s.btnRow}>
            <Btn onClick={onSignIn} primary>[ sign in / register ]</Btn>
            <Btn href="#">[ view releases ]</Btn>
          </div>
        </Section>

        <Rule />

        {/* ── FEATURES ── */}
        <Section path="~/project/features.md" mb={48}>
          <div style={s.grid2} className="blok-lp-grid">
            {FEATURES.map((f) => (
              <FeatureCard key={f.cmd} {...f} />
            ))}
          </div>
        </Section>

        <Rule />

        {/* ── STACK ── */}
        <Section path="~/project/package.json" mb={48}>
          <div style={s.codeBlock}>
            <CL prompt>jq '.dependencies | keys[]' package.json</CL>
            <div style={{ height: 8 }} />
          </div>
          <div style={s.tagCloud}>
            {STACK.map((t) => <StackTag key={t}>{t}</StackTag>)}
          </div>
        </Section>

        <Rule />

        {/* ── SECURITY ── */}
        <Section path="~/project/security.txt" mb={48}>
          <div style={s.codeBlock}>
            <CL comment>{'// all supabase tables guarded by RLS policies'}</CL>
            <CL comment>{'// XSS: DOMPurify allowlist + HTML escaping'}</CL>
            <CL comment>{"// CSP in tauri.conf.json (no unsafe-inline/unsafe-eval)"}</CL>
            <CL comment>{'// invite codes: crypto.getRandomValues — 40-bit CSPRNG'}</CL>
            <CL comment>{'// screen frames clamped to 3840×2160 + 400 KB (canvas DoS guard)'}</CL>
          </div>
        </Section>

        <Rule />

        {/* ── LINKS ── */}
        <Section path="~/project/links.txt" mb={0}>
          <div style={s.btnRow}>
            <Btn href="#">[ github ]</Btn>
            <Btn href="#">[ releases ]</Btn>
            <Btn href="#">[ report issue ]</Btn>
            <Btn onClick={onSignIn}>[ sign in ]</Btn>
          </div>
        </Section>

        {/* ── FOOTER ── */}
        <footer style={s.footer}>
          <span>blok</span><Sep /><span>mit license</span><Sep /><span>2026</span><Sep /><span>v0.9.0</span>
        </footer>

      </div>
    </div>
  );
}

/* ─────────── sub-components ─────────── */

function Section({ path, children, mb }: { path: string; children: React.ReactNode; mb: number }) {
  return (
    <section style={{ marginBottom: mb }}>
      <div style={s.sectionLabel}>
        <span style={s.sectionCorner}>┌─</span>
        <span style={s.sectionPath}>{path}</span>
      </div>
      {children}
    </section>
  );
}

function FeatureCard({ cmd, title, desc }: { cmd: string; title: string; desc: string }) {
  return (
    <div style={s.featureCard}>
      <div style={s.featureCmd}>[{cmd}]</div>
      <div style={s.featureTitle}>{title}</div>
      <div style={s.featureDesc}>{desc}</div>
    </div>
  );
}

function StackTag({ children }: { children: React.ReactNode }) {
  return <span style={s.stackTag}>{children}</span>;
}

function Btn({
  children, href, onClick, primary,
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  primary?: boolean;
}) {
  const base: React.CSSProperties = {
    ...s.btn,
    borderColor: primary ? '#4a4a4a' : '#222',
    color: primary ? '#e0e0e0' : '#555',
  };
  if (onClick) {
    return (
      <button className="blok-lp-btn" onClick={onClick} style={base}>
        {children}
      </button>
    );
  }
  return (
    <a
      className="blok-lp-btn"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={base}
    >
      {children}
    </a>
  );
}

function NavA({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="blok-lp-nav-a" href={href} target="_blank" rel="noopener noreferrer" style={s.navA}>
      {children}
    </a>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span style={s.badge}>{children}</span>;
}

function Rule() { return <hr style={s.rule} />; }

function CL({ children, prompt, comment }: { children?: React.ReactNode; prompt?: boolean; comment?: boolean }) {
  return (
    <div style={{ ...s.codeLine, color: comment ? '#3a3a3a' : prompt ? '#555' : '#888' }}>
      {prompt && <span style={{ color: '#2e2e2e', marginRight: 8 }}>$</span>}
      {children}
    </div>
  );
}

function Dim({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#2e2e2e' }}>{children}</span>;
}

function Dot() { return <span style={s.badgeSep}>·</span>; }
function Sep() { return <span style={s.footerSep}>·</span>; }

/* ─────────── styles ─────────── */

const MONO = '"IBM Plex Mono", "JetBrains Mono", "Courier New", monospace';

const s = {
  root: {
    background: '#000',
    minHeight: '100vh',
    fontFamily: MONO,
    position: 'relative' as const,
    overflowX: 'hidden' as const,
  },
  grid: {
    position: 'fixed' as const,
    inset: 0,
    backgroundImage: [
      'linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px)',
      'linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)',
    ].join(', '),
    backgroundSize: '36px 36px',
    pointerEvents: 'none' as const,
    zIndex: 0,
  },
  col: {
    position: 'relative' as const,
    zIndex: 1,
    maxWidth: 660,
    margin: '0 auto',
    padding: '36px 28px 96px',
  },

  // nav
  nav: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 },
  navBrand: { color: '#e0e0e0', fontSize: 12, letterSpacing: '0.12em', fontWeight: 500 },
  navMeta: { color: '#333', fontSize: 11, flex: 1 },
  navLinks: { display: 'flex', gap: 20 },
  navA: { color: '#444', fontSize: 11, textDecoration: 'none', letterSpacing: '0.06em' },
  navRule: { borderTop: '1px solid #141414', marginBottom: 56 },

  // hero
  logo: {
    color: '#fff',
    fontSize: 'clamp(6px, 1.4vw, 10px)',
    lineHeight: 1.15,
    letterSpacing: '0.04em',
    margin: '0 0 24px',
    whiteSpace: 'pre' as const,
    overflow: 'hidden',
    userSelect: 'none' as const,
  },
  badges: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 18, flexWrap: 'wrap' as const },
  badge: { border: '1px solid #1e1e1e', color: '#3a3a3a', fontSize: 10, padding: '2px 7px', letterSpacing: '0.08em' },
  badgeSep: { color: '#1e1e1e', fontSize: 10 },
  tagline: { color: '#555', fontSize: 12, margin: 0, lineHeight: 1.7, letterSpacing: '0.02em' },

  // dividers
  rule: { border: 'none', borderTop: '1px solid #141414', margin: '48px 0' },

  // section
  sectionLabel: { marginBottom: 16, display: 'flex', alignItems: 'center' },
  sectionCorner: { color: '#252525', fontSize: 11 },
  sectionPath: { color: '#383838', fontSize: 11, letterSpacing: '0.06em', marginLeft: 4 },

  // code
  codeBlock: { background: '#040404', border: '1px solid #141414', padding: '14px 18px', marginBottom: 18 },
  codeLine: { fontSize: 12, lineHeight: 1.75, fontFamily: MONO },

  // features
  grid2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 1,
    background: '#111',
    border: '1px solid #111',
  },
  featureCard: { background: '#000', padding: '16px 18px' },
  featureCmd: { fontSize: 10, color: '#2e2e2e', marginBottom: 7, letterSpacing: '0.12em' },
  featureTitle: { fontSize: 12, color: '#c0c0c0', marginBottom: 6, fontWeight: 500, letterSpacing: '0.03em' },
  featureDesc: { fontSize: 11, color: '#444', lineHeight: 1.65 },

  // stack
  tagCloud: { display: 'flex', flexWrap: 'wrap' as const, gap: 8 },
  stackTag: { border: '1px solid #1a1a1a', color: '#484848', fontSize: 11, padding: '3px 10px', letterSpacing: '0.05em' },

  // buttons
  btn: {
    display: 'inline-block',
    border: '1px solid #222',
    color: '#555',
    fontSize: 12,
    padding: '8px 16px',
    textDecoration: 'none',
    letterSpacing: '0.06em',
    background: 'transparent',
    cursor: 'pointer',
    fontFamily: MONO,
    userSelect: 'none' as const,
  },
  btnRow: { display: 'flex', gap: 10, flexWrap: 'wrap' as const },

  // footer
  footer: {
    marginTop: 64,
    borderTop: '1px solid #0e0e0e',
    paddingTop: 20,
    color: '#282828',
    fontSize: 11,
    letterSpacing: '0.06em',
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap' as const,
  },
  footerSep: { color: '#1a1a1a' },
} as const;
