export default async function handler(req, res) {
    const { videoId } = req.query;

    if (!videoId) {
        return res.status(400).json({ error: 'videoId required' });
    }

    // CORS 헤더
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');

    try {
        // YouTube Innertube API로 자막 트랙 정보 가져오기
        const playerResponse = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            body: JSON.stringify({
                context: {
                    client: {
                        clientName: 'WEB',
                        clientVersion: '2.20250101.00.00',
                        hl: 'ko',
                        gl: 'KR'
                    }
                },
                videoId: videoId
            })
        });

        const playerData = await playerResponse.json();
        const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

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

        // 자막 데이터 가져오기
        const captionResponse = await fetch(trackUrl + '&fmt=json3', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const captionData = await captionResponse.json();

        const texts = [];
        for (const event of (captionData.events || [])) {
            for (const seg of (event.segs || [])) {
                const text = (seg.utf8 || '').trim();
                if (text && text !== '\n') {
                    texts.push(text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
                }
            }
        }

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
