// Private usage numbers. Needs the STATS_TOKEN environment variable as a bearer token.
const { timingSafeEqual } = require("crypto");
const { pipeline, day } = require("./_redis");

function authorized(header, secret) {
    const a = Buffer.from(String(header || ""));
    const b = Buffer.from(`Bearer ${secret}`);
    return a.length === b.length && timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
    const secret = process.env.STATS_TOKEN;
    if (!secret || !authorized(req.headers.authorization, secret)) return res.status(401).end();

    const days = Array.from({ length: 30 }, (_, i) => day(i));
    const week = days.slice(0, 7);
    const [versions] = (await pipeline([["SMEMBERS", "u:vers"]])) || [[]];
    const versionList = (versions || []).sort();
    const results = await pipeline([
        ["PFCOUNT", "u:all"],
        ["PFCOUNT", ...days.map((d) => `u:d:${d}`)],
        ["PFCOUNT", ...week.map((d) => `u:d:${d}`)],
        ["PFCOUNT", ...week.map((d) => `u:r:${d}`)],
        ["PFCOUNT", `u:d:${days[0]}`],
        ...days.slice(0, 14).map((d) => ["PFCOUNT", `u:d:${d}`]),
        ...versionList.map((v) => ["PFCOUNT", ...week.map((d) => `u:v:${d}:${v}`)]),
    ]);
    if (!results) return res.status(503).json({ error: "Storage is not connected" });

    const [everUsed, last30Days, last7Days, regularThisWeek, today] = results;
    const daily = results.slice(5, 19);
    const versionCounts = results.slice(19);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
        everUsed,
        last30Days,
        last7Days,
        regularThisWeek,
        today,
        daily: days.slice(0, 14).map((date, i) => ({ date, people: daily[i] })),
        versionsThisWeek: Object.fromEntries(versionList.map((v, i) => [v, versionCounts[i]]).filter(([, n]) => n > 0)),
    });
};
