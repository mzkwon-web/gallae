export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://mzkwon-web.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const key = process.env.SEOUL_SUBWAY_API_KEY;

  if (!key) {
    return res.status(500).json({
      status: 'error',
      error: 'SEOUL_SUBWAY_API_KEY is missing'
    });
  }

  const stationName = '가산디지털단지';
  const station = encodeURIComponent(stationName);

  const url =
    `http://swopenapi.seoul.go.kr/api/subway/${key}` +
    `/json/realtimeStationArrival/0/30/${station}`;

  const requestedAt = new Date();

  try {
    const response = await fetch(url, {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`Seoul subway API HTTP ${response.status}`);
    }

    const raw = await response.json();

    const arrivals = (raw.realtimeArrivalList || [])
      .filter(row => String(row.subwayId) === '1007')
      .map(row => {
        const observedAt = row.recptnDt || null;

        let ageSeconds = null;

        if (observedAt) {
          const observedDate = new Date(
            observedAt.replace(' ', 'T') + '+09:00'
          );

          ageSeconds = Math.max(
            0,
            Math.round((requestedAt.getTime() - observedDate.getTime()) / 1000)
          );
        }

        return {
          destination: row.bstatnNm,
          direction: row.updnLine,
          train_line: row.trainLineNm,
          arrival_message: row.arvlMsg2,
          current_location: row.arvlMsg3,
          train_no: row.btrainNo,

          observed_at: observedAt,
          age_seconds: ageSeconds,

          // 오늘은 3분을 임시 freshness 기준으로 사용
          freshness:
            ageSeconds !== null && ageSeconds <= 180
              ? 'fresh'
              : 'stale'
        };
      });

    return res.status(200).json({
      status: 'ok',
      station: stationName,
      line: '7호선',
      requested_at: requestedAt.toISOString(),
      arrivals
    });

  } catch (error) {
    return res.status(500).json({
      status: 'error',
      requested_at: requestedAt.toISOString(),
      error: error.message
    });
  }
}
