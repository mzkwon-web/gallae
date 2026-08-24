(function(global){
  'use strict';

  const SOURCE_TYPES = new Set(['api','measured','preference','constraint','rule']);

  function validEvidence(items){
    return (items || []).filter(item => item && SOURCE_TYPES.has(item.source) && item.text);
  }

  function normalizeConnection(item, fallbackSource){
    if(!item || !item.departure_at) return null;
    return {
      id:item.id || null,
      departure_at:item.departure_at,
      arrival_at:item.arrival_at || null,
      travel_minutes:item.travel_minutes == null ? null : Number(item.travel_minutes),
      data_source:String(item.data_source || fallbackSource || 'estimate').toLowerCase(),
      evidence:validEvidence(item.evidence)
    };
  }

  function normalizeConnections(items, fallbackSource){
    return (items || []).map(item => normalizeConnection(item, fallbackSource)).filter(Boolean);
  }

  // v0.1 deliberately does not infer Doksan direction, service pattern, or train delay.
  // The realtime origin may enter the rolling engine only after the probe-derived
  // direction rule has been validated from observed API values.
  function normalizeDoksanOrigin(origin){
    if(!origin || origin.direction_validated !== true) return null;
    if(!origin.departure_at || !origin.arrival_at) return null;
    return {
      id:origin.id || origin.btrainNo || null,
      departure_at:origin.departure_at,
      arrival_at:origin.arrival_at,
      planned_departure_at:origin.planned_departure_at || null,
      data_source:'realtime',
      evidence:validEvidence([
        ...(origin.evidence || []),
        {source:'api', text:'독산역 1호선 서울시 실시간 도착정보 API 관측값 사용'},
        {source:'rule', text:'구로 방향 판별 규칙은 probe 실제 관측값으로 검증된 경우에만 적용'}
      ])
    };
  }

  function buildHybridInput(options){
    const origin = normalizeDoksanOrigin(options && options.origin);
    if(!origin){
      return {status:'unavailable', reason:'doksan_realtime_origin_not_validated'};
    }

    const schedule = options.schedule || {};
    const guroSosa = normalizeConnections(schedule.guro_to_sosa, 'schedule');
    const sosaSincheon = normalizeConnections(schedule.sosa_to_sincheon, 'schedule');
    if(!guroSosa.length || !sosaSincheon.length){
      return {status:'unavailable', reason:'schedule_fallback_missing'};
    }

    return {
      status:'ok',
      input:{
        id:options.id || 'doksan-hybrid',
        origin,
        target_at:options.target_at,
        deadline_at:options.deadline_at,
        final_access_minutes:Number(options.final_access_minutes || 0),
        transfer_score:Number(options.transfer_score || 0),
        stability_score:Number(options.stability_score || 0),
        preference_score:Number(options.preference_score || 0),
        legs:[
          {
            id:'guro-to-sosa', from:'구로', to:'소사', connections:guroSosa,
            evidence:[{source:'rule', text:'서울 실시간 API 범위 밖 구간은 schedule/plan fallback 사용'}]
          },
          {
            id:'sosa-to-sincheon', from:'소사', to:'신천', connections:sosaSincheon,
            evidence:[{source:'rule', text:'서울 실시간 API 범위 밖 구간은 schedule/plan fallback 사용'}]
          }
        ],
        evidence:validEvidence([
          ...(options.evidence || []),
          {source:'rule', text:'데이터 우선순위 realtime → schedule/plan → estimate'},
          {source:'constraint', text:'서울시 지하철 실시간 도착정보 API는 서울시 외 역구간 실시간 데이터원으로 사용하지 않음'}
        ])
      }
    };
  }

  function normalizeBusFallback(bus){
    if(!bus || !bus.departure_at) return null;
    return {
      id:bus.id || 'gwangsa-bus-fallback',
      departure_at:bus.departure_at,
      arrival_at:bus.arrival_at || null,
      travel_minutes:bus.travel_minutes == null ? null : Number(bus.travel_minutes),
      data_source:bus.data_source || 'realtime',
      evidence:validEvidence([
        ...(bus.evidence || []),
        {source:'api', text:'실시간 버스 도착정보 기반 fallback 후보'}
      ])
    };
  }

  global.GallaePhase2HybridInput = {
    SOURCE_TYPES:Array.from(SOURCE_TYPES),
    normalizeDoksanOrigin,
    normalizeConnections,
    buildHybridInput,
    normalizeBusFallback
  };
})(typeof window !== 'undefined' ? window : globalThis);
