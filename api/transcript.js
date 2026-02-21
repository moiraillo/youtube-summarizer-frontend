export default async function handler(req, res) {
    const { videoId } = req.query;

    if (!videoId) {
        return res.status(400).json({ error: 'videoId required' });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    try {
        // YouTube 영상 페이지 HTML 가져오기
        const pageResponse = await fetch('https://www.youtube.com/watch?v=' + videoId, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept': 'text/html,application/xhtml+xml'
            }
        });

        if (!pageResponse.ok) {
            throw new Error('YouTube 페이지 로드 실패: ' + pageResponse.status);
        }

        const html = await pageResponse.text();

        // ytInitialPlayerResponse에서 자막 트랙 추출
        const playerRegex = /ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s;
        const playerMatch = html.match(playerRegex);
        
        let tracks = [];

        if (playerMatch) {
            try {
                const playerData = JSON.parse(playerMatch[1]);
                tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            } catch (e) {
                console.error('playerResponse 파싱 실패:', e.message);
            }
        }

        // 못 찾으면 captionTracks 직접 추출
        if (tracks.length === 0) {
            const captionRegex = /"captionTracks":\s*(\[.*?\])\s*,/;
            const match = html.match(captionRegex);
            if (match) {
                try {
                    tracks = JSON.parse(match[1].replace(/\\u0026/g, '&'));
                } catch (e) {
                    console.error('captionTracks 파싱 실패:', e.message);
                }
            }
        }

        if (tracks.length === 0) {
            return res.status(404).json({ error: '사용 가능한 자막이 없습니다' });
        }

        // 한국어 > 영어 > 첫번째
        let trackUrl = null;
        for (const lang of ['ko', 'en']) {
            const found = tracks.find(t => t.languageCode === lang);
            if (found) { trackUrl = found.baseUrl; break; }
        }
        if (!trackUrl) trackUrl = tracks[0].baseUrl;

        // URL 디코딩
        trackUrl = trackUrl.replace(/\\u0026/g, '&');

        // 자막 XML 가져오기
        const captionResponse = await fetch(trackUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const xmlText = await captionResponse.text();

        // XML에서 텍스트 추출
        const textMatches = xmlText.match(/<text[^>]*>([\s\S]*?)<\/text>/g) || [];
        const texts = textMatches.map(t => {
            return t.replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .trim();
        }).filter(t => t);

        if (texts.length === 0) {
            return res.status(404).json({ error: '자막 텍스트가 비어있습니다' });
        }

        return res.status(200).json({
            success: true,
            transcript: texts.join(' '),
            video_id: videoId
        });

    } catch (error) {
        console.error('자막 추출 실패:', error);
        return res.status(500).json({ error: '자막 추출 실패: ' + error.message });
    }
}
