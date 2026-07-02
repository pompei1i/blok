import { useState } from "react";
import { X } from "lucide-react";
import { useEconomyStore } from "@/lib/store/economy-store";
import { BOX_COST, PITY_N, rarityColor, nameplateStyle, bannerBackground, bannerClass, type CatalogItem } from "@/lib/economy";
import type { CosmeticType, Rarity } from "@/lib/store/types";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PixelLootBox } from "./pixel-loot-box";
import { CoinIcon } from "./coin-icon";
import { AvatarFrameSVG } from "./avatar-frame-svg";

type SubTab = "box" | "shop" | "inventory";

const TYPE_ORDER: CosmeticType[] = ["nameplate", "avatar_frame", "banner"];
const RARITIES: Rarity[] = ["common", "rare", "epic", "legendary"];

const rarityKey = (r: Rarity) => `store.rarity.${r}` as TranslationKey;
const typeKey = (t: CosmeticType) => `store.type.${t}` as TranslationKey;

// ── Visual preview of a cosmetic item ───────────────────────────────────────
function CosmeticPreview({ item }: { item: CatalogItem }) {
  const p = item.payload ?? {};
  if (item.type === "nameplate") {
    // Reuse the live nameplate renderer so previews match the real effect
    // (glow/neon/flame/glitch), not just the base color/gradient.
    const { style, className } = nameplateStyle({
      cosmetics: { nameplate: { id: item.id, rarity: item.rarity, payload: p } },
    });
    return <span className={cn("text-sm font-bold", className)} style={style}>@name</span>;
  }
  if (item.type === "avatar_frame") {
    if (typeof p.shape === "string") {
      return (
        <span className="relative inline-flex items-center justify-center w-7 h-7 rounded-full bg-[var(--bg-elevated)] border border-[var(--border)]">
          <AvatarFrameSVG shape={p.shape} color={p.color ?? p.ring ?? "#888"} color2={p.color2} />
        </span>
      );
    }
    return (
      <span
        className="inline-block w-6 h-6 rounded-full"
        style={{ boxShadow: `0 0 0 2px ${p.ring ?? "#888"}`, background: "var(--bg-elevated)" }}
      />
    );
  }
  // Banner — reuse the live renderer so overlays/animation show in the preview.
  const fakeUser = { cosmetics: { banner: { id: item.id, rarity: item.rarity, payload: p } } };
  const bg = bannerBackground(fakeUser) ?? "var(--bg-elevated)";
  const cls = bannerClass(fakeUser);
  return (
    <span
      className={cn("inline-block w-12 h-5 rounded", cls)}
      style={{ background: bg }}
    />
  );
}

function ItemCard({
  item,
  owned,
  equipped,
  footer,
  onClick,
}: {
  item: CatalogItem;
  owned?: boolean;
  equipped?: boolean;
  footer?: React.ReactNode;
  onClick?: () => void;
}) {
  const { t } = useI18n();
  const color = rarityColor(item.rarity);
  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative flex flex-col gap-1.5 p-2 pt-2.5 border bg-[var(--bg-surface)] overflow-hidden transition-all duration-150",
        onClick && "cursor-pointer hover:bg-[var(--bg-hover)] hover:-translate-y-0.5",
      )}
      style={{
        borderColor: equipped ? color : `${color}55`,
        boxShadow: equipped ? `inset 0 0 0 1px ${color}, 0 0 12px ${color}33` : undefined,
      }}
    >
      {/* rarity accent bar */}
      <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: color }} />

      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color }}>
          {t(rarityKey(item.rarity))}
        </span>
        {owned && (equipped ? (
          <span
            className="text-[9px] font-mono font-bold uppercase tracking-wide px-1 leading-tight"
            style={{ color, border: `1px solid ${color}` }}
          >
            {t("store.equipped")}
          </span>
        ) : (
          <span className="text-[9px] font-mono uppercase tracking-wide text-[var(--text-muted)]">
            {t("store.ownedShort")}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-center h-10 border border-[var(--border)]/40 bg-[var(--bg-base)]/50">
        <CosmeticPreview item={item} />
      </div>

      <p className="text-[12px] font-medium text-[var(--text-primary)] truncate text-center">{item.name}</p>
      {footer}
    </div>
  );
}

// ── Drop reveal overlay ─────────────────────────────────────────────────────
function DropReveal() {
  const { t } = useI18n();
  const lastDrop = useEconomyStore((s) => s.lastDrop);
  const catalog = useEconomyStore((s) => s.catalog);
  const clearDrop = useEconomyStore((s) => s.clearDrop);
  const equipItem = useEconomyStore((s) => s.equipItem);
  if (!lastDrop) return null;

  const item = catalog.find((c) => c.id === lastDrop.itemId);
  const color = rarityColor(lastDrop.rarity);

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 p-4 bg-[var(--bg-base)]/95 animate-fade-in"
      onClick={clearDrop}
    >
      <span className="text-[12px] font-mono uppercase tracking-widest" style={{ color }}>
        {t(rarityKey(lastDrop.rarity))}
      </span>
      <div
        className="flex items-center justify-center w-24 h-24 border-2"
        style={{ borderColor: color, boxShadow: `0 0 24px ${color}66` }}
      >
        {item ? <CosmeticPreview item={item} /> : <PixelLootBox className="w-12 h-12" />}
      </div>
      <p className="text-sm font-bold text-[var(--text-primary)]">{item?.name ?? lastDrop.itemId}</p>
      {lastDrop.duplicate ? (
        <p className="text-xs text-[var(--accent-purple,#a855f7)]">
          {t("store.duplicate").replace("{n}", String(lastDrop.dustAwarded))}
        </p>
      ) : (
        item && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              void equipItem(item.id);
              clearDrop();
            }}
            className="px-3 py-1 text-xs font-bold text-white bg-[var(--accent-red)] hover:bg-[var(--accent-red)]/80 transition-colors"
          >
            {t("store.equipNow")}
          </button>
        )
      )}
      <p className="text-[11px] text-[var(--text-muted)]">{t("store.closeHint")}</p>
    </div>
  );
}

// ── Box section ─────────────────────────────────────────────────────────────
function BoxSection() {
  const { t } = useI18n();
  const coins = useEconomyStore((s) => s.coins);
  const epicPity = useEconomyStore((s) => s.epicPity);
  const legendaryPity = useEconomyStore((s) => s.legendaryPity);
  const opening = useEconomyStore((s) => s.opening);
  const openBox = useEconomyStore((s) => s.openBox);
  const canAfford = coins >= BOX_COST;

  return (
    <div className="flex flex-col items-center gap-4 py-5">
      {/* Framed loot box */}
      <div
        className="relative flex items-center justify-center w-24 h-24 border border-[var(--border)] bg-[var(--bg-surface)]"
        style={{ boxShadow: "0 0 28px rgba(168,85,247,0.12)" }}
      >
        <span className="absolute top-1 left-1.5 text-[10px] font-mono text-[var(--text-muted)] opacity-40 select-none">┌</span>
        <span className="absolute bottom-1 right-1.5 text-[10px] font-mono text-[var(--text-muted)] opacity-40 select-none">┘</span>
        <PixelLootBox className="w-16 h-16" />
      </div>

      <p className="text-xs text-[var(--text-muted)] text-center max-w-[240px] leading-relaxed">{t("store.boxDesc")}</p>

      <button
        disabled={!canAfford || opening}
        onClick={() => void openBox()}
        className={cn(
          "px-5 py-2 text-sm font-bold uppercase tracking-wide transition-all",
          canAfford && !opening
            ? "text-white bg-[var(--accent-red)] hover:bg-[var(--accent-red)]/85 hover:shadow-[0_0_16px_rgba(192,57,43,0.5)]"
            : "text-[var(--text-muted)] bg-[var(--bg-elevated)] cursor-not-allowed",
        )}
      >
        {opening ? t("store.opening") : (() => {
          const [pre, post] = t("store.openBox").replace("{cost}", String(BOX_COST)).split("🪙");
          return <span className="inline-flex items-center gap-1">{pre}<CoinIcon className="w-3.5 h-3.5" />{post}</span>;
        })()}
      </button>
      {!canAfford && <p className="text-[11px] text-[var(--text-muted)]">{t("store.notEnoughCoins")}</p>}

      {/* Pity meters: epic at 10, legendary at 90 */}
      <div className="w-full space-y-3">
        {/* Epic pity (10) */}
        <div>
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wide text-[var(--text-muted)] mb-1">
            <span>{t("store.pity")} · {t("store.rarity.epic")}</span>
            <span className="text-[var(--accent-purple,#a855f7)]">{epicPity}/10</span>
          </div>
          <div className="w-full h-1.5 bg-[var(--bg-elevated)] overflow-hidden">
            <div
              className="h-full bg-[var(--accent-purple,#a855f7)] transition-all"
              style={{ width: `${Math.min(100, (epicPity / 10) * 100)}%` }}
            />
          </div>
        </div>
        {/* Legendary pity (90) */}
        <div>
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wide text-[var(--text-muted)] mb-1">
            <span>{t("store.pity")} · {t("store.rarity.legendary")}</span>
            <span className="text-[var(--accent-purple,#a855f7)]">{legendaryPity}/{PITY_N}</span>
          </div>
          <div className="w-full h-1.5 bg-[var(--bg-elevated)] overflow-hidden">
            <div
              className="h-full bg-[var(--accent-purple,#a855f7)] transition-all"
              style={{ width: `${Math.min(100, (legendaryPity / PITY_N) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Possible drops legend */}
      <div className="w-full pt-3 border-t border-[var(--border)]">
        <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] mb-2">
          {t("store.possibleDrops")}
        </p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {RARITIES.map((r) => (
            <div key={r} className="flex items-center gap-2 text-[11px] font-mono">
              <span className="w-2 h-2 flex-shrink-0" style={{ background: rarityColor(r) }} />
              <span style={{ color: rarityColor(r) }}>{t(rarityKey(r))}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Shop section ────────────────────────────────────────────────────────────
function ShopSection() {
  const { t } = useI18n();
  const catalog = useEconomyStore((s) => s.catalog);
  const inventory = useEconomyStore((s) => s.inventory);
  const coins = useEconomyStore((s) => s.coins);
  const dust = useEconomyStore((s) => s.dust);
  const buyItem = useEconomyStore((s) => s.buyItem);
  const [busy, setBusy] = useState<string | null>(null);

  const forSale = catalog
    .filter((c) => c.shopCost != null)
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));

  return (
    <div className="grid grid-cols-2 gap-2 py-2">
      {forSale.map((item) => {
        const owned = inventory.has(item.id);
        const cur = item.shopCurrency;
        const bal = cur === "dust" ? dust : coins;
        const affordable = (item.shopCost ?? 0) <= bal;
        return (
          <ItemCard
            key={item.id}
            item={item}
            owned={owned}
            footer={
              owned ? (
                <span className="text-[11px] text-center text-[var(--text-muted)]">{t("store.owned")}</span>
              ) : (
                <button
                  disabled={!affordable || busy === item.id}
                  onClick={async () => {
                    setBusy(item.id);
                    await buyItem(item.id);
                    setBusy(null);
                  }}
                  className={cn(
                    "w-full py-1 text-[12px] font-bold flex items-center justify-center gap-1 transition-colors disabled:cursor-not-allowed",
                    affordable
                      ? "text-white bg-[var(--accent-red)] hover:bg-[var(--accent-red)]/85"
                      : "text-[var(--text-muted)] bg-[var(--bg-elevated)]",
                  )}
                >
                  {cur === "dust" ? <span>✦</span> : <CoinIcon className="w-3 h-3" />}{item.shopCost}
                </button>
              )
            }
          />
        );
      })}
    </div>
  );
}

// ── Inventory section ───────────────────────────────────────────────────────
// Exported so the settings modal can reuse the same equip/unequip grid.
export function InventorySection() {
  const { t } = useI18n();
  const catalog = useEconomyStore((s) => s.catalog);
  const inventory = useEconomyStore((s) => s.inventory);
  const equipped = useEconomyStore((s) => s.equipped);
  const equipItem = useEconomyStore((s) => s.equipItem);
  const unequipSlot = useEconomyStore((s) => s.unequipSlot);

  const owned = catalog.filter((c) => inventory.has(c.id));

  const isEquipped = (item: CatalogItem) => {
    if (item.type === "nameplate") return equipped.nameplate === item.id;
    if (item.type === "avatar_frame") return equipped.avatarFrame === item.id;
    if (item.type === "banner") return equipped.banner === item.id;
    return false;
  };

  if (owned.length === 0) {
    return <p className="text-xs text-[var(--text-muted)] text-center py-6">{t("store.empty")}</p>;
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      {TYPE_ORDER.map((type) => {
        const items = owned.filter((c) => c.type === type);
        if (items.length === 0) return null;
        return (
          <div key={type} className="flex flex-col gap-1.5">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              {t(typeKey(type))}
            </span>
            <div className="grid grid-cols-2 gap-2">
              {items.map((item) => {
                const eq = isEquipped(item);
                return (
                  <ItemCard
                    key={item.id}
                    item={item}
                    owned
                    equipped={eq}
                    onClick={() => (eq ? void unequipSlot(type) : void equipItem(item.id))}
                    footer={
                      <span className="text-[11px] text-center text-[var(--text-muted)]">
                        {eq ? t("store.clickUnequip") : t("store.clickEquip")}
                      </span>
                    }
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main view ───────────────────────────────────────────────────────────────
export function EconomyView({ onClose }: { onClose?: () => void } = {}) {
  const { t } = useI18n();
  const coins = useEconomyStore((s) => s.coins);
  const dust = useEconomyStore((s) => s.dust);
  const loading = useEconomyStore((s) => s.loading);
  const [sub, setSub] = useState<SubTab>("box");

  const subLabel: Record<SubTab, TranslationKey> = {
    box: "store.box",
    shop: "store.shop",
    inventory: "store.inventory",
  };

  return (
    <div className="relative flex flex-col flex-1 min-h-0">
      {/* Balance header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <span className="text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
          <span className="text-[var(--accent-red)]">$</span> {t("store.tab")}
        </span>
        <div className="flex items-center gap-1.5 text-[11px] font-mono">
          <span className="flex items-center gap-1 px-1.5 py-0.5 border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-primary)]">
            <CoinIcon className="w-3 h-3" />{coins}
          </span>
          <span className="flex items-center gap-1 px-1.5 py-0.5 border border-[var(--accent-purple,#a855f7)]/30 bg-[var(--bg-elevated)] text-[var(--accent-purple,#a855f7)]">
            ✦ {dust}
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="ml-0.5 p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              aria-label={t("store.close")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Sub tabs */}
      <div className="flex items-center gap-1 px-2 pt-1 border-b border-[var(--border)]">
        {(["box", "shop", "inventory"] as SubTab[]).map((s) => (
          <button
            key={s}
            onClick={() => setSub(s)}
            className={cn(
              "relative flex-1 py-1.5 text-[11px] font-mono uppercase tracking-wider transition-colors",
              sub === s
                ? "text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            )}
          >
            {t(subLabel[s])}
            {sub === s && <span className="absolute inset-x-2 bottom-0 h-px bg-[var(--accent-red)]" />}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3">
        {loading ? (
          <p className="text-xs text-[var(--text-muted)] text-center py-6">{t("store.loading")}</p>
        ) : sub === "box" ? (
          <BoxSection />
        ) : sub === "shop" ? (
          <ShopSection />
        ) : (
          <InventorySection />
        )}
      </div>

      <DropReveal />
    </div>
  );
}
