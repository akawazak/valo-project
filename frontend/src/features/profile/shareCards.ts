/** The Duos and match share cards, drawn from the same data the screens show. */
import { SHARE_COLORS as C, SHARE_W, SHARE_H, shareCanvas, font, roundRect, fitFont, wrap, drawBackdrop, drawBrand, drawAvatar, loadShareImage } from "@/lib/shareCard";

const LOGO = "/brand-mark.png";
const LOSS = "#f5a524";

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

export interface DuoShare {
    you: { name: string; cardUrl?: string };
    them: { name: string; cardUrl?: string };
    colours: { you: string; them: string };
    verdict: { lead: string; who?: string; text: string };
    games: number;
    wins: number;
    mapArt?: string;
    rows: { label: string; you: number; them: number }[];
}

export async function drawDuoShare(data: DuoShare) {
    const [art, youCard, themCard, logo] = await Promise.all([loadShareImage(data.mapArt), loadShareImage(data.you.cardUrl), loadShareImage(data.them.cardUrl), loadLogo()]);
    const { canvas, ctx } = shareCanvas();
    drawBackdrop(ctx, art);
    drawBrand(ctx, "Duos", logo);

    ctx.font = font(600, 20);
    ctx.fillStyle = C.muted;
    ctx.textAlign = "right";
    ctx.fillText(`${data.games} games together · ${data.wins} won`, SHARE_W - 56, 68);
    ctx.textAlign = "left";

    // Players, facing each other.
    const size = 92, top = 112;
    drawAvatar(ctx, youCard, 56, top, size, data.colours.you);
    drawAvatar(ctx, themCard, SHARE_W - 56 - size, top, size, data.colours.them);
    fitFont(ctx, data.you.name, 700, 40, 360);
    ctx.fillStyle = C.text;
    ctx.fillText(data.you.name, 56 + size + 24, top + 54);
    ctx.font = font(600, 18); ctx.fillStyle = data.colours.you; ctx.fillText("YOU", 56 + size + 24, top + 82);
    ctx.textAlign = "right";
    fitFont(ctx, data.them.name, 700, 40, 360);
    ctx.fillStyle = C.text;
    ctx.fillText(data.them.name, SHARE_W - 56 - size - 24, top + 54);
    ctx.font = font(600, 18); ctx.fillStyle = data.colours.them; ctx.fillText("YOUR DUO", SHARE_W - 56 - size - 24, top + 82);
    ctx.textAlign = "left";

    // The verdict, with the leader's name in their colour.
    const lead = data.verdict.who || "";
    const sentence = `${lead}${data.verdict.text}`.trim();
    ctx.font = font(700, 46);
    const lines = wrap(ctx, sentence, SHARE_W - 112, 2);
    let y = lines.length > 1 ? 300 : 322;
    lines.forEach((line, i) => {
        if (i === 0 && lead && line.startsWith(lead)) {
            ctx.fillStyle = data.verdict.lead === "you" ? data.colours.you : data.colours.them;
            ctx.fillText(lead, 56, y);
            const w = ctx.measureText(lead).width;
            ctx.fillStyle = C.text;
            ctx.fillText(line.slice(lead.length), 56 + w, y);
        } else {
            ctx.fillStyle = C.text;
            ctx.fillText(line, 56, y);
        }
        y += 56;
    });

    // Three head-to-head numbers with a split bar each; only the leader's side is coloured.
    const colW = (SHARE_W - 112 - 2 * 64) / 3;
    data.rows.slice(0, 3).forEach((row, i) => {
        const x = 56 + i * (colW + 64), base = 470;
        ctx.font = font(600, 18); ctx.fillStyle = C.muted; ctx.fillText(row.label, x, base);
        const youLead = row.you > row.them, themLead = row.them > row.you;
        ctx.font = font(700, 48);
        ctx.fillStyle = youLead ? data.colours.you : C.text;
        ctx.fillText(String(row.you), x, base + 56);
        ctx.textAlign = "right";
        ctx.fillStyle = themLead ? data.colours.them : C.text;
        ctx.fillText(String(row.them), x + colW, base + 56);
        ctx.textAlign = "left";
        const share = row.you + row.them > 0 ? row.you / (row.you + row.them) : 0.5;
        const barY = base + 74, barW = colW;
        roundRect(ctx, x, barY, barW, 6, 3); ctx.fillStyle = C.line; ctx.fill();
        roundRect(ctx, x, barY, Math.max(6, barW * share - 2), 6, 3); ctx.fillStyle = youLead ? data.colours.you : "#3a4a56"; ctx.fill();
        roundRect(ctx, x + barW * share + 2, barY, Math.max(6, barW * (1 - share) - 2), 6, 3); ctx.fillStyle = themLead ? data.colours.them : "#3a4a56"; ctx.fill();
    });

    ctx.font = font(600, 18);
    ctx.fillStyle = C.soft;
    ctx.fillText("Who backs who up · 5v5 games together", 56, SHARE_H - 34);
    return canvas;
}

export interface MatchShare {
    mapName: string;
    mapArt?: string;
    result: "win" | "loss" | "neutral";
    resultLabel: string;
    ownRounds?: number;
    enemyRounds?: number;
    queue: string;
    date: string;
    length: string;
    agentName: string;
    agentIcon?: string;
    rankIcon?: string;
    rankLabel?: string;
    rr?: number;
    mvp?: boolean;
    player: string;
    stats: { label: string; value: string }[];
}

export async function drawMatchShare(data: MatchShare) {
    const [art, agent, rank, logo] = await Promise.all([loadShareImage(data.mapArt), loadShareImage(data.agentIcon), loadShareImage(data.rankIcon), loadLogo()]);
    const { canvas, ctx } = shareCanvas();
    drawBackdrop(ctx, art);
    drawBrand(ctx, "Match", logo);
    const tone = data.result === "win" ? C.win : data.result === "loss" ? LOSS : C.muted;

    // Map and result.
    fitFont(ctx, data.mapName, 700, 84, 620);
    ctx.fillStyle = C.text;
    ctx.fillText(data.mapName, 56, 196);
    ctx.font = font(700, 22);
    const tagW = ctx.measureText(data.resultLabel.toUpperCase()).width + 32;
    roundRect(ctx, 56, 222, tagW, 40, 8);
    ctx.fillStyle = data.result === "win" ? "rgba(34,211,163,.16)" : data.result === "loss" ? "rgba(245,165,36,.16)" : "rgba(154,168,180,.14)";
    ctx.fill();
    ctx.fillStyle = tone;
    ctx.fillText(data.resultLabel.toUpperCase(), 72, 250);
    ctx.font = font(600, 20);
    ctx.fillStyle = C.muted;
    ctx.fillText(`${data.queue} · ${data.date} · ${data.length}`, 56 + tagW + 18, 249);

    // Score.
    if (data.ownRounds !== undefined && data.enemyRounds !== undefined) {
        ctx.textAlign = "right";
        ctx.font = font(700, 96);
        const enemy = String(data.enemyRounds);
        ctx.fillStyle = C.muted;
        ctx.fillText(enemy, SHARE_W - 56, 200);
        const ew = ctx.measureText(enemy).width;
        ctx.fillStyle = C.soft;
        ctx.fillText(":", SHARE_W - 56 - ew - 18, 196);
        const cw = ctx.measureText(":").width;
        ctx.fillStyle = tone;
        ctx.fillText(String(data.ownRounds), SHARE_W - 56 - ew - 36 - cw, 200);
        ctx.font = font(600, 18);
        ctx.fillStyle = C.soft;
        ctx.fillText("YOUR TEAM  ·  ENEMY", SHARE_W - 56, 232);
        ctx.textAlign = "left";
    }

    // Who played, as which agent, and the rank result.
    const rowY = 300;
    if (agent) { ctx.save(); roundRect(ctx, 56, rowY, 72, 72, 12); ctx.clip(); ctx.drawImage(agent, 56, rowY, 72, 72); ctx.restore(); }
    const nameX = agent ? 148 : 56;
    fitFont(ctx, data.player, 700, 32, 520);
    ctx.fillStyle = C.text;
    ctx.fillText(data.player, nameX, rowY + 32);
    ctx.font = font(600, 20);
    ctx.fillStyle = C.muted;
    ctx.fillText(data.agentName + (data.mvp ? "  ·  " : ""), nameX, rowY + 62);
    if (data.mvp) {
        const w = ctx.measureText(data.agentName + "  ·  ").width;
        ctx.fillStyle = "#f5c542";
        ctx.fillText("MVP", nameX + w, rowY + 62);
    }
    if (data.rankLabel) {
        ctx.textAlign = "right";
        const rx = SHARE_W - 56;
        if (rank) ctx.drawImage(rank, rx - 64, rowY + 4, 64, 64);
        const textX = rank ? rx - 80 : rx;
        ctx.font = font(700, 26); ctx.fillStyle = C.text; ctx.fillText(data.rankLabel, textX, rowY + 32);
        if (data.rr) { ctx.font = font(700, 22); ctx.fillStyle = data.rr > 0 ? C.win : LOSS; ctx.fillText(`${data.rr > 0 ? "+" : ""}${data.rr} RR`, textX, rowY + 62); }
        ctx.textAlign = "left";
    }

    // Stats.
    const stats = data.stats.slice(0, 5);
    const gap = 16, w = (SHARE_W - 112 - gap * (stats.length - 1)) / stats.length, top = 418;
    stats.forEach((stat, i) => {
        const x = 56 + i * (w + gap);
        roundRect(ctx, x, top, w, 112, 12);
        ctx.fillStyle = "rgba(12,19,24,.82)";
        ctx.fill();
        ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.stroke();
        ctx.font = font(600, 16); ctx.fillStyle = C.soft; ctx.fillText(stat.label.toUpperCase(), x + 20, top + 34);
        fitFont(ctx, stat.value, 700, 44, w - 40, 24); ctx.fillStyle = C.text; ctx.fillText(stat.value, x + 20, top + 88);
    });
    return canvas;
}
