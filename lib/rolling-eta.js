(function(global){
  'use strict';

  if(!global.GallaeSourceTypes && typeof require === 'function'){
    try{ require('./source-types.js'); }catch(_e){}
  }
  const ALLOWED_SOURCES = new Set((global.GallaeSourceTypes && global.GallaeSourceTypes.TYPES) || []);
  const DATA_PRIORITY = Object.freeze({realtime:0, schedule:1, plan:1, estimate:2});
  const DEFAULT_MIN_TRANSFER_MINUTES = 3;

  function toMs(value){
    if(value instanceof Date) return value.getTime();
    if(typeof value === 'number' && Number.isFinite(value)) return value;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : NaN;
  }

  function addMinutes(value, minutes){
    const ms = toMs(value);
    if(!Number.isFinite(ms)) return null;
    return new Date(ms + Number(minutes || 0) * 60000).toISOString();
  }

  function minutesBetween(later, earlier){
    const a = toMs(later), b = toMs(earlier);
    if(!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.round(((a - b) / 60000) * 10) / 10;
  }

  function validEvidence(items){
    return (items || []).filter(item => item && ALLOWED_SOURCES.has(item.source) && item.text);
  }

  function dataPriority(item){
    const key = String(item && item.data_source || 'estimate').toLowerCase();
    return Object.prototype.hasOwnProperty.call(DATA_PRIORITY, key) ? DATA_PRIORITY[key] : DATA_PRIORITY.estimate;
  }

  function availableConnections(connections, earliestTime){
    const earliest = toMs(earliestTime);
    if(!Number.isFinite(earliest)) return [];
    return (connections || []).filter(item => Number.isFinite(toMs(item && item.departure_at)) && toMs(item.departure_at) >= earliest);
  }

  function nextConnection(connections, earliestTime){
    const available = availableConnections(connections, earliestTime);
    if(!available.length) return null;
    const bestPriority = Math.min(...available.map(dataPriority));
    return available.filter(item => dataPriority(item) === bestPriority).sort((a,b) => toMs(a.departure_at) - toMs(b.departure_at))[0] || null;
  }

  function transferMinutes(leg){
    const raw = leg && leg.min_transfer_minutes;
    const parsed = Number(raw == null ? DEFAULT_MIN_TRANSFER_MINUTES : raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MIN_TRANSFER_MINUTES;
  }

  function rollLeg(currentArrival, leg){
    const minTransfer = transferMinutes(leg);
    const earliestBoarding = addMinutes(currentArrival, minTransfer);
    const connection = nextConnection(leg.connections, earliestBoarding);
    if(!connection) return {status:'unavailable', leg_id:leg.id, reason:'no_connection_after_min_transfer', min_transfer_minutes:minTransfer, earliest_boarding_at:earliestBoarding};
    const arrivalAt = connection.arrival_at || addMinutes(connection.departure_at, connection.travel_minutes);
    if(!arrivalAt || !Number.isFinite(toMs(arrivalAt))){
      return {status:'unavailable', leg_id:leg.id, reason:'connection_arrival_unknown', connection, min_transfer_minutes:minTransfer, earliest_boarding_at:earliestBoarding};
    }
    return {
      status:'ok', leg_id:leg.id, from:leg.from, to:leg.to,
      data_source:String(connection.data_source || 'estimate').toLowerCase(), connection,
      departure_at:connection.departure_at, arrival_at:arrivalAt,
      min_transfer_minutes:minTransfer, earliest_boarding_at:earliestBoarding,
      transfer_wait_minutes:Math.max(0, minutesBetween(connection.departure_at, currentArrival) || 0),
      evidence:validEvidence([...(leg.evidence || []), ...(connection.evidence || []), {source:'rule', text:`최소 환승시간 ${minTransfer}분 이후 연결편부터 탐색`}])
    };
  }

  function deadlineState(finalEta, targetAt, deadlineAt){
    const eta = toMs(finalEta), target = toMs(targetAt), deadline = toMs(deadlineAt);
    if(!Number.isFinite(eta) || !Number.isFinite(target) || !Number.isFinite(deadline)) return 'unknown';
    if(eta <= target) return 'target_met';
    if(eta <= deadline) return 'deadline_met';
    return 'late';
  }

  function deadlineMargin(finalEta, deadlineAt){ return minutesBetween(deadlineAt, finalEta); }

  function marginState(finalEta, deadlineAt){
    const eta = toMs(finalEta), deadline = toMs(deadlineAt);
    if(!Number.isFinite(eta) || !Number.isFinite(deadline)) return 'unknown';
    const margin = (deadline - eta) / 60000;
    if(margin >= 10) return 'sufficient';
    if(margin >= 3) return 'caution';
    return 'urgent';
  }

  function planDeviation(origin){
    if(!origin) return null;
    return minutesBetween(origin.departure_at, origin.planned_departure_at);
  }

  function buildCandidate(input){
    const start = input && input.origin;
    if(!start || !Number.isFinite(toMs(start.departure_at)) || !Number.isFinite(toMs(start.arrival_at))){ return {status:'unavailable', reason:'origin_train_time_unknown'}; }
    const deviation = planDeviation(start), rolled = [];
    let cursor = start.arrival_at;
    for(const leg of (input.legs || [])){
      const result = rollLeg(cursor, leg); rolled.push(result);
      if(result.status !== 'ok') return {status:'unavailable', reason:result.reason, origin:start, plan_deviation_minutes:deviation, legs:rolled, evidence:validEvidence(input.evidence)};
      cursor = result.arrival_at;
    }
    const finalEta = addMinutes(cursor, input.final_access_minutes || 0);
    const dState = deadlineState(finalEta, input.target_at, input.deadline_at);
    const margin = deadlineMargin(finalEta, input.deadline_at);
    const mState = marginState(finalEta, input.deadline_at);
    const evidence = validEvidence([...(input.evidence || []), ...(start.evidence || []), ...rolled.flatMap(x => x.evidence || []), ...(deviation === null ? [] : [{source:'rule', text:`계획 대비 현재 이용 가능 출발편 편차 ${deviation >= 0 ? '+' : ''}${deviation}분을 이후 환승 선택에 반영`}]), {source:'rule', text:'데이터 우선순위 realtime → schedule/plan → estimate'}, {source:'rule', text:'실시간 이용 가능 열차부터 최소 환승시간 이후의 다음 연결편을 순차 선택해 ETA 계산'}]);
    return {status:'ok', id:input.id, origin:start, origin_data_source:String(start.data_source || 'realtime').toLowerCase(), plan_deviation_minutes:deviation, legs:rolled, final_access_minutes:Number(input.final_access_minutes || 0), final_eta:finalEta, target_at:input.target_at, deadline_at:input.deadline_at, deadline_state:dState, deadline_margin_minutes:margin, margin_state:mState, preference_score:Number(input.preference_score || 0), stability_score:Number(input.stability_score || 0), transfer_score:Number(input.transfer_score || 0), evidence};
  }

  function weightedScore(candidate){
    const transfer=Number(candidate.transfer_score||0), stability=Number(candidate.stability_score||0), preference=Number(candidate.preference_score||0);
    if(candidate.margin_state==='sufficient') return transfer+stability+preference;
    if(candidate.margin_state==='caution') return transfer+stability+preference*0.25;
    return 0;
  }

  function rankCandidates(candidates){
    const usable=(candidates||[]).filter(x=>x&&x.status==='ok'&&Number.isFinite(toMs(x.final_eta)));
    return usable.sort((a,b)=>{
      const aUrgent=a.margin_state==='urgent', bUrgent=b.margin_state==='urgent', aLate=a.deadline_state==='late', bLate=b.deadline_state==='late';
      if(aLate!==bLate) return aLate?1:-1;
      if(aUrgent||bUrgent||(aLate&&bLate)){ const etaDiff=toMs(a.final_eta)-toMs(b.final_eta); if(etaDiff!==0) return etaDiff; }
      const aScore=weightedScore(a), bScore=weightedScore(b); if(aScore!==bScore) return bScore-aScore;
      return toMs(a.final_eta)-toMs(b.final_eta);
    });
  }

  global.GallaeRollingETA = {ALLOWED_SOURCES:Array.from(ALLOWED_SOURCES),DATA_PRIORITY,DEFAULT_MIN_TRANSFER_MINUTES,addMinutes,minutesBetween,availableConnections,nextConnection,transferMinutes,rollLeg,deadlineState,deadlineMargin,marginState,planDeviation,buildCandidate,rankCandidates};
})(typeof window !== 'undefined' ? window : globalThis);
