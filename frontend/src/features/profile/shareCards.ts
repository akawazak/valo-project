/** The Duos and match share cards, drawn from the same data the screens show. */
import { SHARE_COLORS as C, SHARE_W, SHARE_H, shareCanvas, font, roundRect, fitFont, wrap, drawBackdrop, drawBrand, drawSite, drawAvatar, loadShareImage, wash, fade, track, lift } from "@/lib/shareCard";

const LOGO = "/brand-mark.png";
const LOSS = "#f5a524";
const GOLD = "#f5c542";

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

/** An agent's full portrait as a square, optionally mirrored so two agents face each other. */
function portrait(ctx: CanvasRenderingContext2D, img: ImageBitmap, cx: number, top: number, size: number, mirror = false) {
    ctx.save();
    if (mirror) { ctx.translate(cx * 2, 0); ctx.scale(-1, 1); }
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 40;
    ctx.drawImage(img, cx - size / 2, top, size, size * (img.height / img.width));
    ctx.restore();
}

/** Text in runs of colour, centred on cx. */
function centredRuns(ctx: CanvasRenderingContext2D, runs: { text: string; color: string }[], cx: number, y: number) {
    const total = runs.reduce((sum, run) => sum + ctx.measureText(run.text).width, 0);
    let x = cx - total / 2;
    for (const run of runs) {
        ctx.fillStyle = run.color;
        ctx.fillText(run.text, x, y);
        x += ctx.measureText(run.text).width;
    }
}

/** A small rounded tag with a tinted fill. */
function chip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, align: "left" | "right" = "left") {
    ctx.font = font(700, 14);
    track(ctx, 1.5);
    const w = ctx.measureText(text).width + 22;
    const left = align === "right" ? x - w : x;
    roundRect(ctx, left, y, w, 26, 6);
    ctx.fillStyle = `${color}2e`;
    ctx.fill();
    ctx.strokeStyle = `${color}80`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(text, left + 11, y + 18);
    track(ctx, 0);
    return w;
}

export interface DuoShare {
    you: { name: string; cardUrl?: string; agent?: string };
    them: { name: string; cardUrl?: string; agent?: string };
    colours: { you: string; them: string };
    verdict: { lead: string; who?: string; text: string };
    games: number;
    wins: number;
    mapArt?: string;
    rows: { label: string; you: number; them: number }[];
}

export async function drawDuoShare(data: DuoShare) {
    const [art, youCard, themCard, youAgent, themAgent, logo] = await Promise.all([
        loadShareImage(data.mapArt), loadShareImage(data.you.cardUrl), loadShareImage(data.them.cardUrl),
        loadShareImage(data.you.agent), loadShareImage(data.them.agent), loadLogo(),
    ]);
    const { canvas, ctx } = shareCanvas();
    const { you: youColour, them: themColour } = data.colours;

    // The shared map, each side tinted in its player's colour, and their main agents facing each other.
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, SHARE_W, SHARE_H);
    if (art) { ctx.globalAlpha = 0.9; drawCover(ctx, art); ctx.globalAlpha = 1; }
    ctx.fillStyle = "rgba(6,11,15,0.55)";
    ctx.fillRect(0, 0, SHARE_W, SHARE_H);
    wash(ctx, 120, 420, 520, youColour, 0.42);
    wash(ctx, SHARE_W - 120, 420, 520, themColour, 0.42);
    if (youAgent) portrait(ctx, youAgent, 175, 20, 700);
    if (themAgent) portrait(ctx, themAgent, SHARE_W - 175, 20, 700, true);
    // The middle stays dark so the numbers read over the art.
    const middle = ctx.createLinearGradient(0, 0, SHARE_W, 0);
    middle.addColorStop(0.18, "rgba(6,11,15,0)");
    middle.addColorStop(0.36, "rgba(6,11,15,0.82)");
    middle.addColorStop(0.64, "rgba(6,11,15,0.82)");
    middle.addColorStop(0.82, "rgba(6,11,15,0)");
    ctx.fillStyle = middle;
    ctx.fillRect(0, 0, SHARE_W, SHARE_H);
    fade(ctx, 120, 0, 0.75);
    fade(ctx, SHARE_H - 190, SHARE_H, 0.92);
    drawBrand(ctx, "Duos", logo);

    // Games together and how many were won.
    const cx = SHARE_W / 2;
    const rate = data.games ? Math.round((data.wins / data.games) * 100) : 0;
    ctx.textAlign = "left";
    lift(ctx);
    ctx.font = font(700, 104);
    centredRuns(ctx, [{ text: String(data.games), color: C.text }], cx, 196);
    lift(ctx, false);
    ctx.font = font(600, 20);
    track(ctx, 1);
    centredRuns(ctx, [{ text: "GAMES TOGETHER  ·  ", color: C.muted }, { text: `${rate}% WON`, color: rate >= 50 ? C.win : LOSS }], cx, 232);
    track(ctx, 0);

    // The verdict, with the leader's name in their colour.
    const lead = data.verdict.who || "";
    const leadColour = data.verdict.lead === "you" ? youColour : themColour;
    ctx.font = font(700, 32);
    const lines = wrap(ctx, `${lead}${data.verdict.text}`.trim(), 560, 2);
    let y = lines.length > 1 ? 296 : 314;
    lift(ctx);
    for (const [i, line] of lines.entries()) {
        const runs = i === 0 && lead && line.startsWith(lead)
            ? [{ text: lead, color: leadColour }, { text: line.slice(lead.length), color: C.text }]
            : [{ text: line, color: C.text }];
        centredRuns(ctx, runs, cx, y);
        y += 40;
    }
    lift(ctx, false);

    // Three head-to-head numbers with a split bar each; only the leader's side is coloured.
    const barW = 520, left = cx - barW / 2;
    data.rows.slice(0, 3).forEach((row, i) => {
        const base = 398 + i * 62;
        const youLead = row.you > row.them, themLead = row.them > row.you;
        ctx.font = font(600, 14);
        track(ctx, 1.5);
        ctx.fillStyle = C.muted;
        ctx.textAlign = "center";
        ctx.fillText(row.label.toUpperCase(), cx, base);
        track(ctx, 0);
        ctx.font = font(700, 30);
        ctx.textAlign = "left";
        ctx.fillStyle = youLead ? youColour : C.text;
        ctx.fillText(String(row.you), left, base + 4);
        ctx.textAlign = "right";
        ctx.fillStyle = themLead ? themColour : C.text;
        ctx.fillText(String(row.them), left + barW, base + 4);
        ctx.textAlign = "left";
        const share = row.you + row.them > 0 ? row.you / (row.you + row.them) : 0.5;
        const barY = base + 16;
        roundRect(ctx, left, barY, Math.max(8, barW * share - 3), 8, 4); ctx.fillStyle = youLead ? youColour : "#3a4a56"; ctx.fill();
        roundRect(ctx, left + barW * share + 3, barY, Math.max(8, barW * (1 - share) - 3), 8, 4); ctx.fillStyle = themLead ? themColour : "#3a4a56"; ctx.fill();
    });

    // The two players in the bottom corners.
    const size = 54, nameY = SHARE_H - 52;
    drawAvatar(ctx, youCard, 56, nameY - 44, size, youColour);
    drawAvatar(ctx, themCard, SHARE_W - 56 - size, nameY - 44, size, themColour);
    lift(ctx);
    fitFont(ctx, data.you.name, 700, 30, 250, 18);
    ctx.fillStyle = C.text;
    ctx.fillText(data.you.name, 56 + size + 22, nameY);
    ctx.textAlign = "right";
    fitFont(ctx, data.them.name, 700, 30, 250, 18);
    ctx.fillText(data.them.name, SHARE_W - 56 - size - 22, nameY);
    lift(ctx, false);
    ctx.font = font(700, 13);
    track(ctx, 2);
    ctx.fillStyle = themColour;
    ctx.fillText("YOUR DUO", SHARE_W - 56 - size - 22, nameY - 34);
    ctx.textAlign = "left";
    ctx.fillStyle = youColour;
    ctx.fillText("YOU", 56 + size + 22, nameY - 34);
    track(ctx, 0);
    drawSite(ctx, cx, SHARE_H - 34, "center");
    return canvas;
}

function drawCover(ctx: CanvasRenderingContext2D, art: ImageBitmap) {
    const scale = Math.max(SHARE_W / art.width, SHARE_H / art.height);
    const sw = SHARE_W / scale, sh = SHARE_H / scale;
    ctx.drawImage(art, (art.width - sw) / 2, (art.height - sh) * 0.4, sw, sh, 0, 0, SHARE_W, SHARE_H);
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
    agentPortrait?: string;
    rankIcon?: string;
    rankLabel?: string;
    rr?: number;
    mvp?: boolean;
    player: string;
    stats: { label: string; value: string }[];
}

export async function drawMatchShare(data: MatchShare) {
    const [art, agent, figure, rank, logo] = await Promise.all([
        loadShareImage(data.mapArt), loadShareImage(data.agentIcon), loadShareImage(data.agentPortrait), loadShareImage(data.rankIcon), loadLogo(),
    ]);
    const { canvas, ctx } = shareCanvas();
    const tone = data.result === "win" ? C.win : data.result === "loss" ? LOSS : C.muted;

    // The map at full colour, a pool of the result colour, and the agent standing on the right.
    drawBackdrop(ctx, art);
    wash(ctx, 900, 380, 560, tone, 0.34);
    if (figure) portrait(ctx, figure, 905, -30, 820);
    const left = ctx.createLinearGradient(0, 0, 720, 0);
    left.addColorStop(0, "rgba(6,11,15,0.7)");
    left.addColorStop(1, "rgba(6,11,15,0)");
    ctx.fillStyle = left;
    ctx.fillRect(0, 0, 720, SHARE_H);
    fade(ctx, SHARE_H - 230, SHARE_H, 0.95);
    // A sliver of the result colour down the left edge.
    ctx.fillStyle = tone;
    ctx.fillRect(0, 0, 6, SHARE_H);
    drawBrand(ctx, "Match", logo);

    // Map and mode, then the result as large as it gets.
    ctx.font = font(700, 18);
    track(ctx, 3);
    ctx.fillStyle = C.text;
    ctx.fillText(data.mapName.toUpperCase(), 56, 148);
    const mapW = ctx.measureText(data.mapName.toUpperCase()).width;
    ctx.fillStyle = C.muted;
    ctx.font = font(600, 18);
    ctx.fillText(`  ·  ${data.queue.toUpperCase()}`, 56 + mapW, 148);
    track(ctx, 0);
    lift(ctx);
    fitFont(ctx, data.resultLabel.toUpperCase(), 800, 124, 640, 60);
    ctx.fillStyle = tone;
    ctx.fillText(data.resultLabel.toUpperCase(), 50, 262);
    lift(ctx, false);

    // Score, then the rank result beside it.
    let x = 56;
    const scoreY = 336;
    if (data.ownRounds !== undefined && data.enemyRounds !== undefined) {
        ctx.font = font(700, 58);
        ctx.fillStyle = C.text;
        ctx.fillText(String(data.ownRounds), x, scoreY);
        x += ctx.measureText(String(data.ownRounds)).width + 12;
        ctx.fillStyle = C.soft;
        ctx.fillText("–", x, scoreY - 4);
        x += ctx.measureText("–").width + 12;
        ctx.fillStyle = C.muted;
        ctx.fillText(String(data.enemyRounds), x, scoreY);
        x += ctx.measureText(String(data.enemyRounds)).width + 30;
        ctx.fillStyle = "rgba(237,240,242,0.22)";
        ctx.fillRect(x, scoreY - 44, 1, 50);
        x += 30;
    }
    if (data.rankLabel) {
        if (rank) { ctx.drawImage(rank, x, scoreY - 50, 56, 56); x += 68; }
        ctx.font = font(700, 22);
        ctx.fillStyle = C.text;
        ctx.fillText(data.rankLabel, x, scoreY - 20);
        if (data.rr) {
            ctx.font = font(700, 20);
            ctx.fillStyle = data.rr > 0 ? C.win : LOSS;
            ctx.fillText(`${data.rr > 0 ? "+" : ""}${data.rr} RR`, x, scoreY + 6);
        }
    } else {
        ctx.font = font(600, 20);
        ctx.fillStyle = C.muted;
        ctx.fillText(`${data.date} · ${data.length}`, x, scoreY - 8);
    }

    // Who played, as which agent.
    const rowY = 384;
    if (agent) { ctx.save(); roundRect(ctx, 56, rowY, 52, 52, 10); ctx.clip(); ctx.drawImage(agent, 56, rowY, 52, 52); ctx.restore(); }
    const nameX = agent ? 124 : 56;
    lift(ctx);
    fitFont(ctx, data.player, 700, 26, 420, 18);
    const playerW = ctx.measureText(data.player).width;
    ctx.fillStyle = C.text;
    ctx.fillText(data.player, nameX, rowY + 24);
    lift(ctx, false);
    if (data.mvp) chip(ctx, "MVP", nameX + playerW + 14, rowY + 2, GOLD);
    ctx.font = font(600, 18);
    ctx.fillStyle = C.muted;
    const sub = data.rankLabel ? `${data.agentName}  ·  ${data.date}  ·  ${data.length}` : data.agentName;
    ctx.fillText(sub, nameX, rowY + 49);

    // Stats across the bottom; the first one (K / D / A) leads.
    const stats = data.stats.slice(0, 5);
    const top = 474, h = 100, w = SHARE_W - 112;
    roundRect(ctx, 56, top, w, h, 14);
    ctx.fillStyle = "rgba(10,16,21,0.78)";
    ctx.fill();
    ctx.strokeStyle = "rgba(237,240,242,0.1)";
    ctx.lineWidth = 1;
    ctx.stroke();
    const weights = stats.map((_, i) => (i === 0 ? 1.6 : 1));
    const unit = w / weights.reduce((a, b) => a + b, 0);
    let cx = 56;
    stats.forEach((stat, i) => {
        const cw = unit * weights[i];
        if (i) { ctx.fillStyle = "rgba(237,240,242,0.1)"; ctx.fillRect(cx, top + 20, 1, h - 40); }
        ctx.font = font(600, 13);
        track(ctx, 2);
        ctx.fillStyle = C.soft;
        ctx.fillText(stat.label.toUpperCase(), cx + 26, top + 34);
        track(ctx, 0);
        fitFont(ctx, stat.value, 700, i === 0 ? 40 : 36, cw - 52, 22);
        ctx.fillStyle = i === 0 ? tone : C.text;
        ctx.fillText(stat.value, cx + 26, top + 78);
        cx += cw;
    });
    drawSite(ctx, SHARE_W - 56, SHARE_H - 24);
    return canvas;
}
