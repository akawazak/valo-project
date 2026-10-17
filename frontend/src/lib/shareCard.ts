/**
 * Share cards: 1200x630 images (the size Discord and X preview well) drawn on a canvas from real data,
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

export function shareCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = SHARE_W;
    canvas.height = SHARE_H;
    const ctx = canvas.getContext("2d")!;
    ctx.textBaseline = "alphabetic";
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

/** Background art, darkened from the left so text stays readable, plus the page ground. */
export function drawBackdrop(ctx: CanvasRenderingContext2D, art: ImageBitmap | null) {
    ctx.fillStyle = SHARE_COLORS.bg;
    ctx.fillRect(0, 0, SHARE_W, SHARE_H);
    if (art) {
        ctx.globalAlpha = 0.55;
        cover(ctx, art, 0, 0, SHARE_W, SHARE_H, 0.4);
        ctx.globalAlpha = 1;
    }
    const shade = ctx.createLinearGradient(0, 0, SHARE_W, 0);
    shade.addColorStop(0, "rgba(6,11,15,0.94)");
    shade.addColorStop(0.55, "rgba(6,11,15,0.78)");
    shade.addColorStop(1, "rgba(6,11,15,0.55)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, SHARE_W, SHARE_H);
}

/** Brand line top-left and the site bottom-right, the same on every card. */
export function drawBrand(ctx: CanvasRenderingContext2D, kicker: string, logo: ImageBitmap | null) {
    if (logo) ctx.drawImage(logo, 56, 44, 34, 34);
    ctx.font = font(700, 22);
    ctx.fillStyle = SHARE_COLORS.text;
    ctx.fillText("VANTA", 100, 69);
    const w = ctx.measureText("VANTA").width;
    ctx.fillStyle = SHARE_COLORS.coral;
    ctx.fillText("VAULT", 100 + w, 69);
    const brandW = w + ctx.measureText("VAULT").width;
    ctx.font = font(600, 18);
    ctx.fillStyle = SHARE_COLORS.soft;
    ctx.fillText(kicker.toUpperCase(), 100 + brandW + 18, 68);
    ctx.fillStyle = SHARE_COLORS.line;
    ctx.fillRect(56, SHARE_H - 70, SHARE_W - 112, 1);
    ctx.font = font(600, 20);
    ctx.fillStyle = SHARE_COLORS.win;
    ctx.textAlign = "right";
    ctx.fillText(SITE, SHARE_W - 56, SHARE_H - 34);
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
