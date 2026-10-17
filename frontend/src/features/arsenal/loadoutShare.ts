/** The loadout share card: the player's card art, their name, and the eight skins worth showing off. */
import { SHARE_COLORS as C, SHARE_W, SHARE_H, shareCanvas, font, roundRect, fitFont, drawBackdrop, drawBrand, drawSite, drawAvatar, loadShareImage, fade, track, lift } from "@/lib/shareCard";
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

/** One skin tile: a tier-coloured glow, the render, and the skin name. Big tiles also name the weapon. */
function tile(ctx: CanvasRenderingContext2D, slot: LoadoutShareSlot, render: ImageBitmap | null, icon: ImageBitmap | null | undefined, x: number, y: number, w: number, h: number, big: boolean) {
    const color = slot.skinned && slot.tier ? slot.tier.color : "#3a4a56";
    ctx.save();
    roundRect(ctx, x, y, w, h, 14);
    const fill = ctx.createLinearGradient(0, y, 0, y + h);
    fill.addColorStop(0, `${color}${slot.skinned ? "30" : "14"}`);
    fill.addColorStop(1, "rgba(8,13,17,0.9)");
    ctx.fillStyle = "rgba(8,13,17,0.82)";
    ctx.fill();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.clip();
    const glow = ctx.createRadialGradient(x + w / 2, y + h * 0.42, 6, x + w / 2, y + h * 0.42, w * 0.62);
    glow.addColorStop(0, `${color}${slot.skinned ? "55" : "1a"}`);
    glow.addColorStop(1, `${color}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, 3);
    if (render) {
        ctx.globalAlpha = slot.skinned ? 1 : 0.5;
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = 18;
        ctx.shadowOffsetY = 6;
        const pad = big ? 34 : 16;
        contain(ctx, render, x + pad, y + (big ? 44 : 16), w - pad * 2, h - (big ? 104 : 54));
        ctx.shadowColor = "transparent";
        ctx.globalAlpha = 1;
    }
    ctx.restore();
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 14);
    ctx.strokeStyle = `${color}${slot.skinned ? "66" : "33"}`;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (icon && slot.skinned) ctx.drawImage(icon, x + w - (big ? 42 : 32), y + (big ? 16 : 12), big ? 26 : 20, big ? 26 : 20);
    if (big) {
        ctx.font = font(700, 13);
        track(ctx, 2.5);
        ctx.fillStyle = color;
        ctx.fillText(slot.weapon.toUpperCase(), x + 22, y + 33);
        track(ctx, 0);
    }
    const maxW = w - (big ? 44 : 24);
    fitFont(ctx, slot.skin, 700, big ? 26 : 16, maxW, 13);
    let name = slot.skin;
    while (name.length > 4 && ctx.measureText(name).width > maxW) name = name.slice(0, -2).trimEnd() + "…";
    ctx.fillStyle = slot.skinned ? C.text : C.muted;
    ctx.fillText(name, x + (big ? 22 : 12), y + h - (big ? 24 : 14));
}

export async function drawLoadoutShare(data: LoadoutShare) {
    const slots = data.slots.slice(0, 8);
    const card = data.cardId ? `https://media.valorant-api.com/playercards/${data.cardId}` : "";
    const tierIcons = [...new Set(data.slots.map((slot) => slot.tier?.icon).filter((icon): icon is string => Boolean(icon)))];
    const [wide, avatar, logo, renders, icons] = await Promise.all([
        loadShareImage(card && `${card}/wideart.png`),
        loadShareImage(card && `${card}/displayicon.png`),
        loadLogo(),
        Promise.all(slots.map((slot) => loadShareImage(slot.image))),
        Promise.all(tierIcons.map((icon) => loadShareImage(icon))),
    ]);
    const iconFor = new Map(tierIcons.map((icon, i) => [icon, icons[i]]));
    const { canvas, ctx } = shareCanvas();
    drawBackdrop(ctx, wide, 0.3);
    fade(ctx, 180, SHARE_H, 0.7);
    drawBrand(ctx, "Loadout", logo);

    // Who it belongs to, and how many of the weapons carry a skin.
    const top = 104, size = 64;
    if (avatar) drawAvatar(ctx, avatar, 56, top, size, "#2a3a46");
    const textX = avatar ? 56 + size + 24 : 56;
    lift(ctx);
    fitFont(ctx, data.title, 700, 50, 620, 26);
    ctx.fillStyle = C.text;
    ctx.fillText(data.title, textX, top + 46);
    lift(ctx, false);
    const skinned = data.slots.filter((slot) => slot.skinned).length;
    ctx.font = font(600, 19);
    let sx = textX;
    if (data.player) {
        ctx.fillStyle = C.muted;
        const who = `${data.player}  ·  `;
        ctx.fillText(who, sx, top + 76);
        sx += ctx.measureText(who).width;
    }
    ctx.fillStyle = C.win;
    const count = `${skinned} of ${data.slots.length}`;
    ctx.fillText(count, sx, top + 76);
    sx += ctx.measureText(count).width;
    ctx.fillStyle = C.muted;
    ctx.fillText(" weapons skinned", sx, top + 76);

    // Edition counts, rarest first, as chips on the top right.
    const counts = new Map<string, { color: string; icon: string; count: number }>();
    for (const slot of data.slots) if (slot.skinned && slot.tier) counts.set(slot.tier.name, { color: slot.tier.color, icon: slot.tier.icon, count: (counts.get(slot.tier.name)?.count || 0) + 1 });
    const editions = [...counts.entries()].sort((a, b) => TIER_ORDER.indexOf(a[0]) - TIER_ORDER.indexOf(b[0])).slice(0, 3);
    let rx = SHARE_W - 56;
    for (const [name, { color, icon, count: n }] of [...editions].reverse()) {
        ctx.font = font(600, 15);
        const nameW = ctx.measureText(name).width;
        ctx.font = font(700, 17);
        const numW = ctx.measureText(String(n)).width;
        const w = 14 + 20 + 8 + numW + 7 + nameW + 14;
        const x = rx - w, y = 48;
        roundRect(ctx, x, y, w, 36, 18);
        ctx.fillStyle = "rgba(8,13,17,0.72)";
        ctx.fill();
        ctx.strokeStyle = `${color}70`;
        ctx.lineWidth = 1;
        ctx.stroke();
        const img = iconFor.get(icon);
        if (img) ctx.drawImage(img, x + 14, y + 8, 20, 20);
        ctx.fillStyle = color;
        ctx.fillText(String(n), x + 42, y + 24);
        ctx.font = font(600, 15);
        ctx.fillStyle = C.text;
        ctx.fillText(name, x + 42 + numW + 7, y + 24);
        rx = x - 10;
    }

    // The two best skins large, the rest in one row underneath.
    const gap = 16, left = 56, inner = SHARE_W - 112;
    const bigW = (inner - gap) / 2;
    slots.slice(0, 2).forEach((slot, i) => tile(ctx, slot, renders[i], slot.tier?.icon ? iconFor.get(slot.tier.icon) : null, left + i * (bigW + gap), 214, bigW, 214, true));
    const rest = slots.slice(2);
    if (rest.length) {
        const smallW = (inner - gap * (rest.length - 1)) / rest.length;
        rest.forEach((slot, i) => tile(ctx, slot, renders[i + 2], slot.tier?.icon ? iconFor.get(slot.tier.icon) : null, left + i * (smallW + gap), 444, smallW, 128, false));
    }
    drawSite(ctx, SHARE_W - 56, 608);
    return canvas;
}
