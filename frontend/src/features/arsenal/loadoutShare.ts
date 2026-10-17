/** The loadout share card: the player's card art, their name, and the eight skins worth showing off. */
import { SHARE_COLORS as C, SHARE_W, shareCanvas, font, roundRect, fitFont, drawBackdrop, drawBrand, drawAvatar, loadShareImage } from "@/lib/shareCard";
import { CONTENT_TIERS } from "@/lib/contentTiers";
import type { LoadoutItemV1, Weapon } from "@/lib/types";

const LOGO = "/brand-mark.png";
// The weapons people look at first; skinned ones win a slot over default ones.
const PRIORITY = ["Vandal", "Phantom", "Operator", "Melee", "Sheriff", "Spectre", "Ghost", "Classic", "Marshal", "Outlaw", "Guardian", "Bulldog", "Odin", "Judge", "Stinger", "Frenzy", "Shorty", "Bucky", "Ares"];
const TIER_ORDER = ["Ultra", "Exclusive", "Premium", "Deluxe", "Select"];

export interface LoadoutShareSlot {
    weapon: string;
    skin: string;
    image?: string;
    tier?: { name: string; color: string; icon: string };
    skinned: boolean;
}

export interface LoadoutShare {
    title: string;
    player?: string;
    cardId?: string;
    slots: LoadoutShareSlot[];
}

/** Picks the slots from a loadout the same way the board resolves each weapon's skin. */
export function loadoutShareSlots(weapons: Weapon[], loadout: Record<string, LoadoutItemV1>): LoadoutShareSlot[] {
    const slots = weapons.map((weapon) => {
        const item = loadout[weapon.uuid];
        const skin = weapon.skins.find((entry) => entry.uuid === item?.skinId) || weapon.skins.find((entry) => entry.uuid === weapon.defaultSkinUuid);
        const chroma = skin?.chromas?.find((entry) => entry.uuid === item?.chromaId) || skin?.chromas?.[0];
        const skinned = Boolean(skin && skin.uuid !== weapon.defaultSkinUuid);
        return {
            weapon: weapon.displayName,
            skin: skinned ? skin!.displayName : `Standard ${weapon.displayName}`,
            image: chroma?.fullRender || skin?.displayIcon || weapon.displayIcon,
            tier: skin ? CONTENT_TIERS[skin.contentTierUuid?.toLowerCase()] : undefined,
            skinned,
        };
    });
    const rank = (name: string) => { const i = PRIORITY.indexOf(name); return i < 0 ? PRIORITY.length : i; };
    return slots.sort((a, b) => Number(b.skinned) - Number(a.skinned) || rank(a.weapon) - rank(b.weapon));
}

async function loadLogo() {
    try {
        const img = new Image();
        img.src = LOGO;
        await img.decode();
        return await createImageBitmap(img, { resizeWidth: 68, resizeHeight: 68 });
    } catch {
        return null;
    }
}

/** Draws an image inside a box without cropping it. */
function contain(ctx: CanvasRenderingContext2D, img: ImageBitmap, x: number, y: number, w: number, h: number) {
    const scale = Math.min(w / img.width, h / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

export async function drawLoadoutShare(data: LoadoutShare) {
    const slots = data.slots.slice(0, 8);
    const card = data.cardId ? `https://media.valorant-api.com/playercards/${data.cardId}` : "";
    const tierIcons = [...new Set(slots.map((slot) => slot.tier?.icon).filter((icon): icon is string => Boolean(icon)))];
    const [wide, avatar, logo, renders, icons] = await Promise.all([
        loadShareImage(card && `${card}/wideart.png`),
        loadShareImage(card && `${card}/displayicon.png`),
        loadLogo(),
        Promise.all(slots.map((slot) => loadShareImage(slot.image))),
        Promise.all(tierIcons.map((icon) => loadShareImage(icon))),
    ]);
    const iconFor = new Map(tierIcons.map((icon, i) => [icon, icons[i]]));
    const { canvas, ctx } = shareCanvas();
    drawBackdrop(ctx, wide);
    drawBrand(ctx, "Loadout", logo);

    // Who it belongs to, and how many of the weapons carry a skin.
    const top = 104, size = 72;
    if (avatar) drawAvatar(ctx, avatar, 56, top, size, "#2a3a46");
    const textX = avatar ? 56 + size + 26 : 56;
    fitFont(ctx, data.title, 700, 44, 640);
    ctx.fillStyle = C.text;
    ctx.fillText(data.title, textX, top + 40);
    ctx.font = font(600, 20);
    ctx.fillStyle = C.muted;
    const skinned = data.slots.filter((slot) => slot.skinned).length;
    ctx.fillText([data.player, `${skinned} of ${data.slots.length} weapons skinned`].filter(Boolean).join("  ·  "), textX, top + 72);

    // Edition counts, rarest first, on the right.
    const counts = new Map<string, { color: string; count: number }>();
    for (const slot of data.slots) if (slot.skinned && slot.tier) counts.set(slot.tier.name, { color: slot.tier.color, count: (counts.get(slot.tier.name)?.count || 0) + 1 });
    const editions = [...counts.entries()].sort((a, b) => TIER_ORDER.indexOf(a[0]) - TIER_ORDER.indexOf(b[0])).slice(0, 3);
    ctx.textAlign = "right";
    let rx = SHARE_W - 56;
    for (const [name, { color, count }] of [...editions].reverse()) {
        ctx.font = font(600, 18); ctx.fillStyle = C.muted;
        ctx.fillText(name, rx, top + 72);
        rx -= ctx.measureText(name).width + 8;
        ctx.font = font(700, 22); ctx.fillStyle = color;
        ctx.fillText(String(count), rx, top + 72);
        rx -= ctx.measureText(String(count)).width + 26;
    }
    ctx.textAlign = "left";

    // Eight skins, four by two.
    const gap = 16, cols = 4, gridTop = 210, tileH = 160;
    const tileW = (SHARE_W - 112 - gap * (cols - 1)) / cols;
    slots.forEach((slot, i) => {
        const x = 56 + (i % cols) * (tileW + gap), y = gridTop + Math.floor(i / cols) * (tileH + gap);
        ctx.save();
        roundRect(ctx, x, y, tileW, tileH, 12);
        ctx.fillStyle = "rgba(12,19,24,.84)";
        ctx.fill();
        ctx.clip();
        if (slot.skinned && slot.tier) {
            const glow = ctx.createRadialGradient(x + tileW / 2, y + 62, 10, x + tileW / 2, y + 62, tileW * 0.6);
            glow.addColorStop(0, `${slot.tier.color}38`);
            glow.addColorStop(1, `${slot.tier.color}00`);
            ctx.fillStyle = glow;
            ctx.fillRect(x, y, tileW, tileH);
            ctx.fillStyle = slot.tier.color;
            ctx.fillRect(x, y, tileW, 3);
        }
        const render = renders[i];
        if (render) { ctx.globalAlpha = slot.skinned ? 1 : 0.55; contain(ctx, render, x + 18, y + 14, tileW - 36, 100); ctx.globalAlpha = 1; }
        ctx.restore();
        roundRect(ctx, x, y, tileW, tileH, 12);
        ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke();
        const icon = slot.tier?.icon && iconFor.get(slot.tier.icon);
        if (icon && slot.skinned) ctx.drawImage(icon, x + tileW - 34, y + 12, 22, 22);
        fitFont(ctx, slot.skin, 700, 19, tileW - 32, 13);
        ctx.fillStyle = slot.skinned ? C.text : C.muted;
        ctx.fillText(slot.skin, x + 16, y + tileH - 18);
    });
    return canvas;
}
