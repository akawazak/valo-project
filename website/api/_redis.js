// Upstash Redis over REST, configured by the Vercel Marketplace integration.
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function pipeline(commands) {
    if (!url || !token) return null;
    const response = await fetch(`${url}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(commands),
    });
    if (!response.ok) throw new Error(`redis ${response.status}`);
    return (await response.json()).map((entry) => entry.result);
}

function day(offset = 0) {
    return new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
}

module.exports = { pipeline, day };
