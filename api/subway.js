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

    const text = await response.text();

    let raw;

    try {
      raw = JSON.parse(text);
    } catch {
      return res.status(200).json({
        status: 'diagnostic',
        requested_at: requestedAt.toISOString(),
        http_status: response.status,
        content_type: response.headers.get('content-type'),
        response_is_json: false,
        response_preview: text.slice(0, 1000)
      });
    }

    return res.status(200).json({
      status: 'diagnostic',
      requested_at: requestedAt.toISOString(),
      http_status: response.status,
      content_type: response.headers.get('content-type'),

      top_level_keys: Object.keys(raw),

      RESULT: raw.RESULT ?? null,
      errorMessage: raw.errorMessage ?? null,
      statusMessage: raw.statusMessage ?? null,
      message: raw.message ?? null,

      realtimeArrivalList_type:
        Array.isArray(raw.realtimeArrivalList)
          ? 'array'
          : typeof raw.realtimeArrivalList,

      realtimeArrivalList_count:
        Array.isArray(raw.realtimeArrivalList)
          ? raw.realtimeArrivalList.length
          : null,

      safe_preview: JSON.stringify(raw).slice(0, 2000)
    });

  } catch (error) {
    return res.status(500).json({
      status: 'error',
      requested_at: requestedAt.toISOString(),
      error: error.message
    });
  }
}
