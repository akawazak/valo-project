// Anonymous daily check-in from the app: a random install id, the version and the platform.
// Ids go into HyperLogLog counters, so they are never stored or listed. IPs are not kept.
const { pipeline, day } = require("./_redis");

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const PLATFORMS = new Set(["windows", "android"]);
const KEEP_SECONDS = 90 * 86400;

module.exports = async (req, res) => {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).end();
    }
    let body = req.body;
    if (typeof body === "string") {
        try { body = JSON.parse(body); } catch { body = null; }
    }
    const { id, version, platform, returning } = body || {};
    if (typeof id !== "string" || !ID.test(id) || typeof version !== "string" || !VERSION.test(version) || !PLATFORMS.has(platform)) {
        return res.status(400).end();
    }
    const date = day();
    const keys = [`u:d:${date}`, `u:v:${date}:${version}`, `u:p:${date}:${platform}`];
    // Returning means the same install also checked in within the previous 8 days
    if (returning === true) keys.push(`u:r:${date}`);
    try {
        await pipeline([
            ...keys.flatMap((key) => [["PFADD", key, id], ["EXPIRE", key, KEEP_SECONDS]]),
            ["PFADD", "u:all", id],
            ["SADD", "u:vers", version],
        ]);
    } catch {
        // Counting is best effort; the app never retries on failure.
    }
    return res.status(204).end();
};
