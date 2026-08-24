(function(global){
  'use strict';

  const ALLOWED_SOURCES = new Set(['api','measured','preference','constraint','rule']);

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

  function validEvidence(items){
    return (items || []).filter(item => item && ALLOWED_SOURCES.has(item.source) && item.text);
  }

  function nextConnection(connections, earliestTime){
    const earliest = toMs(earliestTime);
    if(!Number.isFinite(earliest)) return null;
    return (connections || [])
      .filter(item => Number.isFinite(toMs(item && item.departure_at)) && toMs(item.departure_at) >= earliest)
      .sort((a,b) => toMs(a.departure_at) - toMs(b.departure_at))[0] || null;
  }

  function rollLeg(currentArrival, leg){
    const connection = nextConnection(leg.connections, currentArrival);
    if(!connection) return {status:'unavailable', leg_id:leg.id, reason:'no_connection_after_arrival'};
    const arrivalAt = connection.arrival_at || addMinutes(connection.departure_at, connection.travel_minutes);
    if(!arrivalAt || !Number.isFinite(toMs(arrivalAt))){
      return {status:'unavailable', leg_id:leg.id, reason:'connection_arrival_unknown', connection};
    }
    return {
      status:'ok',
      leg_id:leg.id,
      from:leg.from,
      to:leg.to,
      connection,
      departure_at:connection.departure_at,
      arrival_at:arrivalAt,
      evidence:validEvidence([...(leg.evidence || []), ...(connection.evidence || [])])
    };
  }

  function deadlineState(finalEta, targetAt, deadlineAt){
    const eta = toMs(finalEta), target = toMs(targetAt), deadline = toMs(deadlineAt);
    if(!Number.isFinite(eta) || !Number.isFinite(target) || !Number.isFinite(deadline)) return 'unknown';
    if(eta <= target) return 'target_met';
    if(eta <= deadline) return 'deadline_met';
    return 'late';
  }

  function buildCandidate(input){
    const start = input && input.origin;
    if(!start || !Number.isFinite(toMs(start.departure_at)) || !Number.isFinite(toMs(start.arrival_at))){
      return {status:'unavailable', reason:'origin_train_time_unknown'};
    }

    const rolled = [];
    let cursor = start.arrival_at;
    for(const leg of (input.legs || [])){
      const result = rollLeg(cursor, leg);
      rolled.push(result);
      if(result.status !== 'ok'){
        return {
          status:'unavailable',
          reason:result.reason,
          origin:start,
          legs:rolled,
          evidence:validEvidence(input.evidence)
        };
      }
      cursor = result.arrival_at;
    }

    const finalEta = addMinutes(cursor, input.final_access_minutes || 0);
    const evidence = validEvidence([
      ...(input.evidence || []),
      ...(start.evidence || []),
      ...rolled.flatMap(x => x.evidence || []),
      {source:'rule', text:`실시간 이용 가능 열차부터 다음 연결편을 순차 선택해 ETA 계산`}
    ]);

    return {
      status:'ok',
      id:input.id,
      origin:start,
      legs:rolled,
      final_access_minutes:Number(input.final_access_minutes || 0),
      final_eta:finalEta,
      target_at:input.target_at,
      deadline_at:input.deadline_at,
      deadline_state:deadlineState(finalEta, input.target_at, input.deadline_at),
      preference_score:Number(input.preference_score || 0),
      stability_score:Number(input.stability_score || 0),
      transfer_score:Number(input.transfer_score || 0),
      evidence
    };
  }

  function rankCandidates(candidates){
    const usable = (candidates || []).filter(x => x && x.status === 'ok' && Number.isFinite(toMs(x.final_eta)));
    return usable.sort((a,b) => {
      const aLate = a.deadline_state === 'late';
      const bLate = b.deadline_state === 'late';
      if(aLate !== bLate) return aLate ? 1 : -1;
      if(aLate && bLate) return toMs(a.final_eta) - toMs(b.final_eta);

      // Before the hard deadline, preserve comfort/stability/preference rather than blindly choosing the earliest ETA.
      const aScore = a.transfer_score + a.stability_score + a.preference_score;
      const bScore = b.transfer_score + b.stability_score + b.preference_score;
      if(aScore !== bScore) return bScore - aScore;
      return toMs(a.final_eta) - toMs(b.final_eta);
    });
  }

  global.GallaeRollingETA = {
    ALLOWED_SOURCES:Array.from(ALLOWED_SOURCES),
    addMinutes,
    nextConnection,
    rollLeg,
    deadlineState,
    buildCandidate,
    rankCandidates
  };
})(typeof window !== 'undefined' ? window : globalThis);
