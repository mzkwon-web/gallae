export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://mzkwon-web.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

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

    const raw = await response.json();

    if (
      raw?.status === 500 ||
      raw?.code === 'INFO-100' ||
      raw?.errorMessage?.code !== 'INFO-000'
    ) {
      return res.status(502).json({
        status: 'error',
        requested_at: requestedAt.toISOString(),
        api_code: raw?.code ?? raw?.errorMessage?.code ?? null,
        api_message:
          raw?.message ??
          raw?.errorMessage?.message ??
          '서울 지하철 API 응답 오류'
      });
    }

    const rows = Array.isArray(raw.realtimeArrivalList)
      ? raw.realtimeArrivalList
      : [];

    const arrivals = rows
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
            Math.round(
              (requestedAt.getTime() - observedDate.getTime()) / 1000
            )
          );
        }

        const isFresh =
          ageSeconds !== null &&
          ageSeconds <= 180;

        return {
          subway_id: row.subwayId ?? null,
          station: row.statnNm ?? stationName,

          destination: row.bstatnNm ?? null,
          direction: row.updnLine ?? null,
          train_line: row.trainLineNm ?? null,
          train_no: row.btrainNo ?? null,

          arrival_message: row.arvlMsg2 ?? null,
          current_location: row.arvlMsg3 ?? null,
          arrival_code: row.arvlCd ?? null,
          arrival_seconds:
            row.barvlDt !== undefined && row.barvlDt !== null
              ? Number(row.barvlDt)
              : null,

          observed_at: observedAt,
          age_seconds: ageSeconds,

          freshness: isFresh ? 'fresh' : 'stale',
          realtime_usable: isFresh
        };
      });

    const freshArrivals = arrivals.filter(
      item => item.realtime_usable === true
    );

    return res.status(200).json({
      status: 'ok',

      station: stationName,
      line: '7호선',

      requested_at: requestedAt.toISOString(),

      freshness_threshold_seconds: 180,

      total_arrivals: arrivals.length,
      fresh_arrival_count: freshArrivals.length,

      realtime_usable: freshArrivals.length > 0,

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
