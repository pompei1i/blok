import { useState } from "react";
import { X } from "lucide-react";
import { useEconomyStore } from "@/lib/store/economy-store";
import { BOX_COST, PITY_N, rarityColor, type CatalogItem } from "@/lib/economy";
import type { CosmeticType, Rarity } from "@/lib/store/types";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type SubTab = "box" | "shop" | "inventory";

const TYPE_ORDER: CosmeticType[] = ["nameplate", "avatar_frame", "badge", "banner"];

const rarityKey = (r: Rarity) => `store.rarity.${r}` as TranslationKey;
const typeKey = (t: CosmeticType) => `store.type.${t}` as TranslationKey;

// ── Visual preview of a cosmetic item ───────────────────────────────────────
function CosmeticPreview({ item }: { item: CatalogItem }) {
  const p = item.payload ?? {};
  if (item.type === "nameplate") {
    const style = Array.isArray(p.gradient)
      ? {
          background: `linear-gradient(90deg, ${p.gradient.join(", ")})`,
          WebkitBackgroundClip: "text" as const,
          backgroundClip: "text" as const,
          color: "transparent",
        }
      : { color: p.color };
    return <span className="text-sm font-bold" style={style}>@name</span>;
  }
  if (item.type === "avatar_frame") {
    return (
      <span
        className="inline-block w-6 h-6 rounded-full"
        style={{ boxShadow: `0 0 0 2px ${p.ring ?? "#888"}`, background: "var(--bg-elevated)" }}
      />
    );
  }
  if (item.type === "badge") {
    return <span className="text-lg leading-none">{p.icon ?? "🎖"}</span>;
  }
  return (
    <span
      className="inline-block w-12 h-5 rounded"
      style={{
        background: Array.isArray(p.gradient)
          ? `linear-gradient(135deg, ${p.gradient.join(", ")})`
          : "var(--bg-elevated)",
      }}
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
        "flex flex-col gap-1.5 p-2 border bg-[var(--bg-surface)] transition-colors",
        onClick && "cursor-pointer hover:bg-[var(--bg-hover)]",
        equipped ? "border-[var(--accent-red)]" : "border-[var(--border)]",
      )}
      style={equipped ? undefined : { borderColor: `${color}44` }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color }}>
          {t(rarityKey(item.rarity))}
        </span>
        {owned && (
          <span className="text-[11px] text-[var(--text-muted)]">
            {equipped ? t("store.equipped") : t("store.ownedShort")}
          </span>
        )}
      </div>
      <div className="flex items-center justify-center h-8">
        <CosmeticPreview item={item} />
      </div>
      <p className="text-[12px] text-[var(--text-primary)] truncate text-center">{item.name}</p>
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
        {item ? <CosmeticPreview item={item} /> : <span className="text-2xl">🎁</span>}
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
  const pity = useEconomyStore((s) => s.pity);
  const opening = useEconomyStore((s) => s.opening);
  const openBox = useEconomyStore((s) => s.openBox);
  const canAfford = coins >= BOX_COST;

  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <div className="text-5xl">🎁</div>
      <p className="text-xs text-[var(--text-muted)] text-center">{t("store.boxDesc")}</p>
      <button
        disabled={!canAfford || opening}
        onClick={() => void openBox()}
        className={cn(
          "px-4 py-2 text-sm font-bold transition-colors",
          canAfford && !opening
            ? "text-white bg-[var(--accent-red)] hover:bg-[var(--accent-red)]/80"
            : "text-[var(--text-muted)] bg-[var(--bg-elevated)] cursor-not-allowed",
        )}
      >
        {opening ? t("store.opening") : t("store.openBox").replace("{cost}", String(BOX_COST))}
      </button>
      {!canAfford && <p className="text-[12px] text-[var(--text-muted)]">{t("store.notEnoughCoins")}</p>}
      <div className="w-full mt-2">
        <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)] mb-0.5">
          <span>{t("store.pity")}</span>
          <span>{pity}/{PITY_N}</span>
        </div>
        <div className="w-full h-1 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--accent-purple,#a855f7)] transition-all"
            style={{ width: `${Math.min(100, (pity / PITY_N) * 100)}%` }}
          />
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
                    "w-full py-0.5 text-[12px] font-bold transition-colors",
                    affordable
                      ? "text-white bg-[var(--accent-red)] hover:bg-[var(--accent-red)]/80"
                      : "text-[var(--text-muted)] bg-[var(--bg-elevated)] cursor-not-allowed",
                  )}
                >
                  {cur === "dust" ? "✦" : "🪙"}{item.shopCost}
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
function InventorySection() {
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
    return equipped.badges.includes(item.id);
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
                    onClick={() => (eq && type !== "badge" ? void unequipSlot(type) : void equipItem(item.id))}
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
        <span className="text-[12px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
          <span className="text-[var(--accent-red)]">$</span> {t("store.tab")}
        </span>
        <span className="text-[11px] text-[var(--text-primary)] flex items-center gap-2">
          <span>🪙 {coins}</span>
          <span className="text-[var(--accent-purple,#a855f7)]">✦ {dust}</span>
          {onClose && (
            <button
              onClick={onClose}
              className="ml-1 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              title={t("store.close")}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </span>
      </div>

      {/* Sub tabs */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--border)]">
        {(["box", "shop", "inventory"] as SubTab[]).map((s) => (
          <button
            key={s}
            onClick={() => setSub(s)}
            className={cn(
              "flex-1 py-1 text-[12px] font-mono uppercase tracking-wider transition-colors",
              sub === s
                ? "text-[var(--text-primary)] bg-[var(--bg-elevated)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
            )}
          >
            {t(subLabel[s])}
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
