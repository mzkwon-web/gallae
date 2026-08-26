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

    const rows = Array.isArray(raw.realtimeArrivalList)
      ? raw.realtimeArrivalList
      : [];

    const diagnosticRows = rows.map(row => ({
      subwayId: row.subwayId ?? null,
      statnNm: row.statnNm ?? null,
      updnLine: row.updnLine ?? null,
      trainLineNm: row.trainLineNm ?? null,
      bstatnNm: row.bstatnNm ?? null,
      arvlMsg2: row.arvlMsg2 ?? null,
      arvlMsg3: row.arvlMsg3 ?? null,
      recptnDt: row.recptnDt ?? null,
      btrainNo: row.btrainNo ?? null
    }));

    return res.status(200).json({
      status: 'ok',
      station: stationName,
      requested_at: requestedAt.toISOString(),

      // 서울 API 자체 응답 정보
      api_status: raw.RESULT || null,
      total_rows: rows.length,

      // 실제 subwayId 종류 확인
      subway_ids: [...new Set(
        rows
          .map(row => String(row.subwayId ?? ''))
          .filter(Boolean)
      )],

      // 진단용 최소 필드
      diagnostic_rows: diagnosticRows
    });

  } catch (error) {
    return res.status(500).json({
      status: 'error',
      requested_at: requestedAt.toISOString(),
      error: error.message
    });
  }
}
