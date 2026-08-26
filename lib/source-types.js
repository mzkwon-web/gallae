(function(global){
  'use strict';

  const SOURCE_TYPES = Object.freeze([
    'api',
    'measured',
    'preference',
    'constraint',
    'rule',
    'schedule',
    'calculated',
    'experience'
  ]);

  const LABELS = Object.freeze({
    api:'API 실시간',
    measured:'사용자 실측',
    preference:'사용자 선호',
    constraint:'이동 제약',
    rule:'PoC 규칙',
    schedule:'시간표/계획',
    calculated:'계산 결과',
    experience:'사용자 경험'
  });

  function isSourceType(source){
    return SOURCE_TYPES.includes(String(source || ''));
  }

  const api = Object.freeze({
    SOURCE_TYPES,
    TYPES:SOURCE_TYPES,
    LABELS,
    isSourceType,
    isValid:isSourceType
  });

  global.GallaeSourceTypes = api;

  // v0.1 field-test bridge: the existing Pages UI still requests
  // ./data/subway.json. Intercept only that request and route it to the
  // Vercel serverless API so the rest of the PoC remains unchanged.
  // Do not fall back to the scheduled snapshot here: failure must be visible
  // rather than presenting stale data as LIVE evidence.
  if(typeof window !== 'undefined' && typeof global.fetch === 'function'){
    const originalFetch = global.fetch.bind(global);
    const LIVE_SUBWAY_API = 'https://gallae-ten.vercel.app/api/subway';

    global.fetch = async function(input, init){
      const rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
      const isLegacySubwaySnapshot = rawUrl.startsWith('./data/subway.json');

      if(!isLegacySubwaySnapshot){
        return originalFetch(input, init);
      }

      const response = await originalFetch(LIVE_SUBWAY_API + '?ts=' + Date.now(), {
        ...(init || {}),
        cache:'no-store'
      });

      if(!response.ok){
        throw new Error('Vercel subway API HTTP ' + response.status);
      }

      const live = await response.json();
      if(live.status !== 'ok'){
        throw new Error(live.error || live.api_message || 'Vercel subway API returned an error');
      }

      const usableArrivals = (live.arrivals || []).filter(item => item.realtime_usable === true);
      const normalized = {
        status: live.realtime_usable ? 'ok' : 'stale',
        station: live.station,
        line: live.line,
        updated_at: live.requested_at,
        requested_at: live.requested_at,
        freshness_threshold_seconds: live.freshness_threshold_seconds,
        total_arrivals: live.total_arrivals,
        fresh_arrival_count: live.fresh_arrival_count,
        realtime_usable: live.realtime_usable,
        arrivals: usableArrivals
      };

      return new Response(JSON.stringify(normalized), {
        status:200,
        headers:{'Content-Type':'application/json; charset=utf-8'}
      });
    };
  }

  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
