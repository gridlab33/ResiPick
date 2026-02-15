/**
 * URL Parser Utility
 * Parses social media URLs to extract source, creator info, and metadata
 */

const URL_PATTERNS = {
    instagram: {
        pattern: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(reel|p)\/([A-Za-z0-9_-]+)/i,
        profilePattern: /instagram\.com\/([^\/\?]+)/i,
        name: 'instagram',
        label: 'Instagram',
    },
    youtube: {
        pattern: /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]+)/i,
        name: 'youtube',
        label: 'YouTube',
    },
    tiktok: {
        pattern: /(?:https?:\/\/)?(?:www\.)?(?:tiktok\.com\/@([^\/]+)\/video\/(\d+)|vm\.tiktok\.com\/([A-Za-z0-9]+))/i,
        name: 'tiktok',
        label: 'TikTok',
    },
    naver: {
        pattern: /(?:https?:\/\/)?(?:m\.)?(?:tv\.)?naver\.com\/(?:v|clip)\/(\d+)/i,
        name: 'naver',
        label: 'Naver',
    },
};

/**
 * Fetch Instagram post metadata using RapidAPI
 * Returns { title, description, authorName, thumbnail } or null if failed
 * 
 * Export for external use in RecipeDetailPage and other components
 */
// Helper to extract username from URL if present
export const extractInstagramUsername = (url) => {
    const match = url.match(/instagram\.com\/([^\/\?]+)/i);
    // Filter out 'reel', 'p', 'reels', etc. if they are captured as username
    if (match && match[1]) {
        const candidate = match[1];
        if (['reel', 'p', 'reels', 'explore', 'stories'].includes(candidate.toLowerCase())) {
            return '';
        }
        return candidate;
    }
    return '';
};

// Helper to extract Instagram media ID
export const extractInstagramId = (url) => {
    if (!url) return null;
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/(reel|p)\/([A-Za-z0-9_-]+)/i);
    return match ? match[2] : null;
};

export async function fetchInstagramMetadata(postId, rapidApiKey, originalUrl = '') {
    // Attempt to extract username from URL immediately for fallback
    const urlUsername = originalUrl ? extractInstagramUsername(originalUrl) : '';

    // 1. Try Netlify Function (Serverless) - Cost Free
    // This works if deployed OR if running 'netlify dev' locally.
    // If running 'npm run dev', this will likely 404, so we handle that.
    try {
        if (originalUrl) {
            console.log('☁️ Attempting Netlify Function...');
            const funcUrl = `/.netlify/functions/get-instagram-thumbnail?url=${encodeURIComponent(originalUrl)}`;
            const response = await fetch(funcUrl);

            if (response.ok) {
                const data = await response.json();
                if (data.thumbnail) {
                    console.log('✅ Netlify Function Success:', data);
                    return {
                        title: data.title || (urlUsername ? `Instagram Post by @${urlUsername}` : `Instagram Post`),
                        description: data.description || '',
                        authorName: urlUsername ? `@${urlUsername}` : '',
                        thumbnail: data.thumbnail,
                        source: 'instagram'
                    };
                }
            } else {
                console.warn(`⚠️ Netlify Function failed (${response.status}), falling back...`);
            }
        }
    } catch (e) {
        console.warn('⚠️ Netlify Function skipped (likely local dev without proxy)', e);
    }

    // 2. RapidAPI Fallback (If key provided)
    if (rapidApiKey) {
        console.log(`🔍 Instagram API: Attempting to fetch metadata for post ID: ${postId}`);
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

            // Instagram Scraper Stable API uses media_code parameter (the shortcode)
            const apiUrl = `https://instagram-scraper-stable-api.p.rapidapi.com/get_media_data_v2.php?media_code=${postId}`;
            console.log(`📡 Instagram API: Calling ${apiUrl}`);

            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'X-RapidAPI-Key': rapidApiKey,
                    'X-RapidAPI-Host': 'instagram-scraper-stable-api.p.rapidapi.com'
                },
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.json();
                const actualData = data.data || data;

                // Extract data...
                const captionEdges = actualData.edge_media_to_caption?.edges || [];
                const caption = captionEdges.length > 0 ? captionEdges[0].node.text : '';
                const username = actualData.owner?.username || '';
                const apiThumbnail = actualData.display_url;

                // Fallback thumbnail if API returns null but we have postId
                const finalThumbnail = apiThumbnail || `https://www.instagram.com/p/${postId}/media/?size=l`;

                return {
                    title: caption ? caption.split('\n')[0].substring(0, 100) : `Instagram Post by ${username || 'Unknown'}`,
                    description: caption,
                    authorName: username ? `@${username}` : '',
                    thumbnail: finalThumbnail,
                    source: 'instagram'
                };
            }
        } catch (error) {
            console.error('❌ Instagram API Request Failed:', error);
        }
    } else {
        console.log('Instagram: No RapidAPI key provided, skipping API fetch');
    }

    // 3. Ultimate Fallback (Manual Construction)
    // If Netlify function fails AND API fails/missing, just give the link
    return {
        title: urlUsername ? `Instagram Post by @${urlUsername}` : `Instagram Post (${postId})`,
        description: '',
        authorName: urlUsername ? `${urlUsername}` : '',
        thumbnail: `https://www.instagram.com/p/${postId}/media/?size=l`,
        source: 'instagram'
    };
}

/**
 * Fetch YouTube video metadata using oEmbed API
 * Returns { title, author_name } or null if failed
 */
const INVIDIOUS_INSTANCES = [
    'https://inv.tux.pizza',
    'https://invidious.jing.rocks',
    'https://vid.puffyan.us',
    'https://inv.bp.projectsegfau.lt',
    'https://invidious.nerdvpn.de'
];

/**
 * Helper to fetch from Invidious with failover
 */
async function fetchFromInvidious(videoId) {
    for (const base of INVIDIOUS_INSTANCES) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout per instance

            const response = await fetch(`${base}/api/v1/videos/${videoId}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.ok) {
                return await response.json();
            }
        } catch (e) {
            // Continue to next instance
        }
    }
    return null; // Return null instead of throwing to allow graceful fallback
}

/**
     * Fetch from YouTube Data API if user has provided API key
     */
async function fetchFromYouTubeAPI(videoId, apiKey) {
    if (!apiKey) return null;

    try {
        const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
        const response = await fetch(url);

        if (!response.ok) return null;

        const data = await response.json();
        if (!data.items || data.items.length === 0) return null;

        const snippet = data.items[0].snippet;
        return {
            title: snippet.title,
            authorName: snippet.channelTitle,
            description: snippet.description,
            thumbnail: snippet.thumbnails?.maxres?.url || snippet.thumbnails?.high?.url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
        };
    } catch (e) {
        console.error('YouTube Data API error:', e);
        return null;
    }
}

/**
 * Fallback to oEmbed (title and author only, no description)
 */
async function fetchFromOEmbed(videoId) {
    try {
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;

        const response = await fetch(oEmbedUrl);
        if (!response.ok) return null;

        const data = await response.json();
        return {
            title: data.title || null,
            authorName: data.author_name || null,
            description: '',
            thumbnail: data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
        };
    } catch (e) {
        return null;
    }
}

/**
 * Fetch YouTube video metadata with multi-tier fallback
 * Priority: 1. Invidious (free, no setup) → 2. YouTube API (if key provided) → 3. oEmbed (basic)
 * Returns { title, authorName, description, thumbnail, source } or null
 * 
 * Export for external use in RecipeDetailPage and other components
 */
export async function fetchYouTubeMetadata(videoId, youtubeApiKey = null) {
    // Try 1: Invidious (free, includes description)
    console.log('Trying Invidious...');
    const invidiousData = await fetchFromInvidious(videoId);
    if (invidiousData) {
        console.log('✓ Invidious success');
        return { ...invidiousData, source: 'invidious' };
    }

    // Try 2: YouTube Data API (if user provided key)
    if (youtubeApiKey) {
        console.log('Invidious failed, trying YouTube Data API...');
        const apiData = await fetchFromYouTubeAPI(videoId, youtubeApiKey);
        if (apiData) {
            console.log('✓ YouTube API success');
            return { ...apiData, source: 'youtube_api' };
        }
    }

    // Try 3: oEmbed (last resort, no description)
    console.log('Trying oEmbed fallback...');
    const oEmbedData = await fetchFromOEmbed(videoId);
    if (oEmbedData) {
        console.log('✓ oEmbed success (no description)');
        return { ...oEmbedData, source: 'oembed' };
    }

    console.log('✗ All methods failed');
    return null;
}

/**
 * Parse a URL and extract source and video ID
 */
export function parseUrl(url) {
    if (!url) return null;

    const trimmedUrl = url.trim();

    for (const [sourceName, config] of Object.entries(URL_PATTERNS)) {
        const match = trimmedUrl.match(config.pattern);
        if (match) {
            let creatorHandle = '';
            let videoId = '';

            if (sourceName === 'instagram') {
                videoId = match[2];
                const profileMatch = trimmedUrl.match(config.profilePattern);
                if (profileMatch && profileMatch[1] !== 'reel' && profileMatch[1] !== 'p') {
                    creatorHandle = `@${profileMatch[1]}`;
                }
            } else if (sourceName === 'youtube') {
                videoId = match[1];
            } else if (sourceName === 'tiktok') {
                creatorHandle = match[1] ? `@${match[1]}` : '';
                videoId = match[2] || match[3] || '';
            } else if (sourceName === 'naver') {
                videoId = match[1];
            }

            // Generate suggested title based on source and date
            // YouTube and Instagram can fetch real titles
            const today = new Date();
            const dateStr = `${today.getMonth() + 1}/${today.getDate()}`;
            const suggestedTitle = `${config.label} 레시피 (${dateStr})`;

            // isTempTitle: true for platforms that can't fetch real titles
            // YouTube and Instagram can fetch metadata if API keys are provided
            const isTempTitle = sourceName !== 'youtube' && sourceName !== 'instagram';

            return {
                url: trimmedUrl,
                source: config.name,
                sourceLabel: config.label,
                videoId,
                creatorHandle,
                suggestedTitle,
                isTempTitle,
                thumbnail: getThumbnailUrl(config.name, videoId),
            };
        }
    }

    return null;
}

/**
 * Get thumbnail URL for supported platforms
 */
function getThumbnailUrl(source, videoId) {
    if (!videoId) return null;

    switch (source) {
        case 'youtube':
            return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
        default:
            // Instagram and TikTok don't provide easy thumbnail access
            // User will need to add their own image
            return null;
    }
}

/**
 * Get source info by name
 */
export function getSourceInfo(sourceName) {
    const config = URL_PATTERNS[sourceName];
    if (!config) return null;

    return {
        name: config.name,
        label: config.label,
    };
}

/**
 * Get all supported sources
 */
export function getSupportedSources() {
    return Object.values(URL_PATTERNS).map((config) => ({
        name: config.name,
        label: config.label,
    }));
}

/**
 * Validate if a URL is from a supported source
 */
export function isValidUrl(url) {
    return parseUrl(url) !== null;
}
