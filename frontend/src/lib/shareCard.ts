/**
 * Share cards: 1200x630 images (the size Discord and X preview well, drawn at 2x) made on a canvas from real data,
 * then copied to the clipboard or saved. Game art is fetched as bytes so the canvas stays exportable:
 * through Tauri's HTTP plugin in the app (no cross-origin limits), or plain fetch for same-origin art.
 */
import { appFetch } from "./fetch";

export const SHARE_W = 1200;
export const SHARE_H = 630;
const SITE = "vanta-vault-app.vercel.app";
const FONT = '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
export const SHARE_COLORS = { bg: "#060b0f", panel: "#0c1318", line: "#1b2731", text: "#edf0f2", muted: "#9aa8b4", soft: "#76858f", win: "#22d3a3", coral: "#ff4055" };

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function loadShareImage(url?: string): Promise<ImageBitmap | null> {
    if (!url) return null;
    try {
        // The web demo serves its own copies of the art; it registers this hook to map the URLs.
        const demoMedia = (window as { __vvDemoMedia?: (u: string) => Promise<string | null> }).__vvDemoMedia;
        if (demoMedia && !url.startsWith("/")) url = (await demoMedia(url)) || url;
        const sameOrigin = new URL(url, location.href).origin === location.origin;
        const response = isTauri() && !sameOrigin ? await appFetch(url) : sameOrigin ? await fetch(url) : null;
        if (!response?.ok) return null;
        return await createImageBitmap(await response.blob());
    } catch {
        return null;
    }
}

/** Drawn at twice the size so the image stays sharp when it is pasted and zoomed; code works in 1200x630 units. */
export const SHARE_SCALE = 2;

export function shareCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = SHARE_W * SHARE_SCALE;
    canvas.height = SHARE_H * SHARE_SCALE;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(SHARE_SCALE, SHARE_SCALE);
    ctx.textBaseline = "alphabetic";
    ctx.imageSmoothingQuality = "high";
    return { canvas, ctx };
}

export const font = (weight: number, size: number) => `${weight} ${size}px ${FONT}`;

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/** Draws an image to fill a box, cropped like CSS object-fit: cover. */
export function cover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number, focusY = 0.5) {
    const scale = Math.max(w / img.width, h / img.height);
    const sw = w / scale, sh = h / scale;
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) * focusY, sw, sh, x, y, w, h);
}

/** Shrinks text until it fits a width; returns the size used. */
export function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxWidth: number, min = 18) {
    let s = size;
    ctx.font = font(weight, s);
    while (s > min && ctx.measureText(text).width > maxWidth) { s -= 2; ctx.font = font(weight, s); }
    return s;
}

/** Wraps text into at most `lines` lines inside maxWidth. */
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, lines = 2) {
    const words = text.split(/\s+/);
    const out: string[] = [];
    let line = "";
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > maxWidth && line) { out.push(line); line = word; } else line = next;
    }
    if (line) out.push(line);
    if (out.length > lines) { out.length = lines; out[lines - 1] = out[lines - 1].replace(/\s*\S*$/, "…"); }
    return out;
}

/** Background art at full colour, darkened from the left so text stays readable. */
export function drawBackdrop(ctx: CanvasRenderingContext2D, art: ImageBitmap | null, focusY = 0.4) {
    ctx.fillStyle = SHARE_COLORS.bg;
    ctx.fillRect(0, 0, SHARE_W, SHARE_H);
    if (art) cover(ctx, art, 0, 0, SHARE_W, SHARE_H, focusY);
    const shade = ctx.createLinearGradient(0, 0, SHARE_W, 0);
    shade.addColorStop(0, "rgba(6,11,15,0.92)");
    shade.addColorStop(0.42, "rgba(6,11,15,0.72)");
    shade.addColorStop(1, "rgba(6,11,15,0.2)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, SHARE_W, SHARE_H);
}

/** A soft pool of colour, used to tint a card by result or player. Takes a #rrggbb colour. */
export function wash(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, alpha: number) {
    const hex = Math.round(alpha * 255).toString(16).padStart(2, "0");
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, `${color}${hex}`);
    glow.addColorStop(1, `${color}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, SHARE_W, SHARE_H);
}

/** Fades the card into the ground colour between two heights. */
export function fade(ctx: CanvasRenderingContext2D, from: number, to: number, alpha: number) {
    const g = ctx.createLinearGradient(0, from, 0, to);
    g.addColorStop(0, "rgba(6,11,15,0)");
    g.addColorStop(1, `rgba(6,11,15,${alpha})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, Math.min(from, to), SHARE_W, Math.abs(to - from));
}

/** Letter spacing for labels; ignored where the canvas doesn't support it. */
export function track(ctx: CanvasRenderingContext2D, px: number) {
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`;
}

/** A soft shadow under text that sits on art. */
export function lift(ctx: CanvasRenderingContext2D, on = true) {
    ctx.shadowColor = on ? "rgba(0,0,0,0.6)" : "transparent";
    ctx.shadowBlur = on ? 16 : 0;
    ctx.shadowOffsetY = on ? 2 : 0;
}

/** Brand lockup top-left, the same on every card. */
export function drawBrand(ctx: CanvasRenderingContext2D, kicker: string, logo: ImageBitmap | null) {
    if (logo) ctx.drawImage(logo, 56, 44, 34, 34);
    ctx.font = font(700, 22);
    ctx.fillStyle = SHARE_COLORS.text;
    ctx.fillText("VANTA", 100, 69);
    const w = ctx.measureText("VANTA").width;
    ctx.fillStyle = SHARE_COLORS.coral;
    ctx.fillText("VAULT", 100 + w, 69);
    const brandW = w + ctx.measureText("VAULT").width;
    ctx.fillStyle = "rgba(237,240,242,0.3)";
    ctx.fillRect(100 + brandW + 16, 50, 1, 24);
    ctx.font = font(600, 15);
    track(ctx, 2);
    ctx.fillStyle = SHARE_COLORS.muted;
    ctx.fillText(kicker.toUpperCase(), 100 + brandW + 33, 68);
    track(ctx, 0);
}

/** The site, small, at a spot each card chooses. */
export function drawSite(ctx: CanvasRenderingContext2D, x: number, y: number, align: CanvasTextAlign = "right") {
    ctx.font = font(600, 17);
    ctx.textAlign = align;
    ctx.fillStyle = SHARE_COLORS.win;
    ctx.fillText(SITE, x, y);
    ctx.textAlign = "left";
}

/** Player card art in the rounded-square frame with a colour ring, as in Duos. */
export function drawAvatar(ctx: CanvasRenderingContext2D, img: ImageBitmap | null, x: number, y: number, size: number, ring: string) {
    ctx.save();
    roundRect(ctx, x - 5, y - 5, size + 10, size + 10, 18);
    ctx.fillStyle = ring;
    ctx.fill();
    roundRect(ctx, x - 2, y - 2, size + 4, size + 4, 15);
    ctx.fillStyle = SHARE_COLORS.bg;
    ctx.fill();
    roundRect(ctx, x, y, size, size, 13);
    ctx.clip();
    if (img) cover(ctx, img, x, y, size, size, 0.2);
    else { ctx.fillStyle = SHARE_COLORS.panel; ctx.fillRect(x, y, size, size); }
    ctx.restore();
}

export async function canvasBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("Could not create the image.")), "image/png"));
}

/** Copies the card; returns false when the clipboard refuses images. */
export async function copyShareImage(blob: Blob) {
    try {
        if (!("ClipboardItem" in window) || !navigator.clipboard?.write) return false;
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        return true;
    } catch {
        return false;
    }
}

export function saveShareImage(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}
