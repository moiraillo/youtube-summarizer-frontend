export default async function handler(req, res) {
    const { videoId, debug } = req.query;

    if (!videoId) {
        return res.status(400).json({ error: 'videoId required' });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
        // YouTube 페이지 가져오기
        const pageResponse = await fetch('https://www.youtube.com/watch?v=' + videoId, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept': 'text/html,application/xhtml+xml',
                'Cookie': 'CONSENT=YES+1'
            }
        });

        const html = await pageResponse.text();

        // 디버그 모드
        if (debug === '1') {
            const hasCaptions = html.includes('captionTracks');
            const hasPlayerResponse = html.includes('ytInitialPlayerResponse');
            const hasTimedText = html.includes('timedtext');
            const pageLength = html.length;
            const titleMatch = html.match(/<title>(.*?)<\/title>/);

            return res.status(200).json({
                debug: true,
                pageLength,
                title: titleMatch ? titleMatch[1] : 'not found',
                hasCaptions,
                hasPlayerResponse,
                hasTimedText,
                snippet: html.substring(0, 500)
            });
        }

        // captionTracks를 여러 방식으로 추출 시도
        let tracks = [];

        // 방법 1: ytInitialPlayerResponse
        const playerRegex = /ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var|let|const)/s;
        const playerMatch = html.match(playerRegex);
        if (playerMatch) {
            try {
                const playerData = JSON.parse(playerMatch[1]);
                tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
            } catch (e) {}
        }

        // 방법 2: 좀 더 느슨한 정규식
        if (tracks.length === 0) {
            const playerRegex2 = /ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s;
            const playerMatch2 = html.match(playerRegex2);
            if (playerMatch2) {
                try {
                    const playerData = JSON.parse(playerMatch2[1]);
                    tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
                } catch (e) {}
            }
        }

        // 방법 3: captionTracks 직접 추출
        if (tracks.length === 0) {
            const captionRegex = /"captionTracks":(\[.*?\])/;
            const captionMatch = html.match(captionRegex);
            if (captionMatch) {
                try {
                    tracks = JSON.parse(captionMatch[1].replace(/\\u0026/g, '&'));
                } catch (e) {}
            }
        }

        // 방법 4: baseUrl 직접 추출
        if (tracks.length === 0) {
            const urlRegex = /"baseUrl":"(https:\/\/www\.youtube\.com\/api\/timedtext[^"]+)"/g;
            let urlMatch;
            while ((urlMatch = urlRegex.exec(html)) !== null) {
                let url = urlMatch[1].replace(/\\u0026/g, '&');
                const langMatch = url.match(/lang=([a-z]{2})/);
                tracks.push({
                    baseUrl: url,
                    languageCode: langMatch ? langMatch[1] : 'unknown'
                });
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
        trackUrl = trackUrl.replace(/\\u0026/g, '&');

        // 자막 XML 가져오기
        const captionResponse = await fetch(trackUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const xmlText = await captionResponse.text();
        const textMatches = xmlText.match(/<text[^>]*>([\s\S]*?)<\/text>/g) || [];
        const texts = textMatches.map(t => {
            return t.replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
                .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
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
