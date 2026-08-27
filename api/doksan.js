export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://mzkwon-web.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const key = process.env.SEOUL_SUBWAY_API_KEY;
  const requestedAt = new Date();
  if (!key) return res.status(500).json({status:'error', requested_at:requestedAt.toISOString(), error:'SEOUL_SUBWAY_API_KEY is missing'});

  const stationName = '독산';
  const url = `http://swopenapi.seoul.go.kr/api/subway/${key}/json/realtimeStationArrival/0/50/${encodeURIComponent(stationName)}`;
  try {
    const response = await fetch(url, {cache:'no-store'});
    const raw = await response.json();
    const apiCode = raw?.code ?? raw?.errorMessage?.code ?? null;
    const apiMessage = raw?.message ?? raw?.errorMessage?.message ?? null;
    if (apiCode === 'INFO-200') return res.status(200).json({status:'ok',station:stationName,line:'1호선',requested_at:requestedAt.toISOString(),freshness_threshold_seconds:60,total_arrivals:0,fresh_arrival_count:0,realtime_usable:false,reason:'no_realtime_data',rows:[]});
    if (raw?.status === 500 || apiCode === 'INFO-100' || apiCode !== 'INFO-000') return res.status(502).json({status:'error',requested_at:requestedAt.toISOString(),api_code:apiCode,api_message:apiMessage||'서울 지하철 API 응답 오류'});

    const fields=['subwayId','updnLine','bstatnNm','trainLineNm','btrainNo','btrainSttus','barvlDt','arvlMsg2','arvlMsg3','arvlCd','subwayHeading','recptnDt','statnFid','statnTid','statnId','statnNm','ordkey'];
    const rows=(Array.isArray(raw.realtimeArrivalList)?raw.realtimeArrivalList:[]).filter(row=>String(row.subwayId)==='1001').map(row=>{
      const item=Object.fromEntries(fields.filter(key=>key in row).map(key=>[key,row[key]]));
      const observedAt=row.recptnDt||null;
      const observedMs=observedAt?Date.parse(observedAt.replace(' ','T')+'+09:00'):NaN;
      const ageSeconds=Number.isFinite(observedMs)?Math.max(0,Math.round((requestedAt.getTime()-observedMs)/1000)):null;
      const usable=ageSeconds!==null&&ageSeconds<=60;
      return {...item,observed_at:observedAt,age:ageSeconds,age_seconds:ageSeconds,freshness:usable?'fresh':'stale',realtime_usable:usable};
    });
    const freshCount=rows.filter(row=>row.realtime_usable).length;
    return res.status(200).json({status:'ok',station:stationName,line:'1호선',requested_at:requestedAt.toISOString(),freshness_threshold_seconds:60,total_arrivals:rows.length,fresh_arrival_count:freshCount,realtime_usable:freshCount>0,rows});
  } catch (error) {
    return res.status(500).json({status:'error',requested_at:requestedAt.toISOString(),error:error.message});
  }
}
