export default async (req, context) => {
    const url = new URL(req.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
        return new Response(JSON.stringify({ error: "Missing url parameter" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    // Basic validation to ensure it's an Instagram URL
    if (!targetUrl.includes("instagram.com")) {
        return new Response(JSON.stringify({ error: "Invalid URL. Only Instagram URLs are supported." }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        // Fetch the Instagram page acting as a bot to get Open Graph tags
        const response = await fetch(targetUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5"
            },
        });

        if (!response.ok) {
            return new Response(JSON.stringify({ error: `Failed to fetch Instagram page: ${response.status}` }), {
                status: response.status,
                headers: { "Content-Type": "application/json" },
            });
        }

        const html = await response.text();

        // Regex to extract og:image
        // <meta property="og:image" content="..." />
        const match = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/i);

        // Also try checking for title/description while we're at it? 
        // User mainly wants thumbnail, but title would be nice.
        const titleMatch = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]+)"/i);
        const descMatch = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]+)"/i);

        if (match && match[1]) {
            const result = {
                thumbnail: match[1],
                title: titleMatch ? titleMatch[1] : null,
                description: descMatch ? descMatch[1] : null
            };

            return new Response(JSON.stringify(result), {
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "public, max-age=3600" // Cache for 1 hour
                },
            });
        }

        return new Response(JSON.stringify({ error: "No og:image metadata found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
        });

    } catch (error) {
        console.error("Function error:", error);
        return new Response(JSON.stringify({ error: "Internal Server Error", details: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
