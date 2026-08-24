(function(global){
  'use strict';

  function parseKst(value){
    const text=String(value||'').trim();
    if(!text) return null;
    if(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) return text;
    const m=text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
    return m?`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`:null;
  }

  function addMinutes(value,minutes){
    const ms=Date.parse(value), n=Number(minutes);
    return Number.isFinite(ms)&&Number.isFinite(n)?new Date(ms+n*60000).toISOString():null;
  }

  function minutesBetween(later,earlier){
    const a=Date.parse(later), b=Date.parse(earlier);
    return Number.isFinite(a)&&Number.isFinite(b)?Math.round(((a-b)/60000)*10)/10:null;
  }

  // Realtime supplies train position/state. Timetable supplies elapsed/remaining minutes.
  // Missing timetable duration means unavailable: v0.1 does not invent a default.
  function boardingEta(candidate,profile){
    if(!candidate||candidate.direction_validated!==true||candidate.already_departed_current_snapshot) return null;
    const observed=parseKst(candidate.observed_at);
    if(!observed) return null;
    const p=profile||{};
    let remaining=null, basis=null;

    if(candidate.arrival_code==='1'){
      remaining=0;
      basis='arrived_doksan_snapshot';
    }else if(candidate.arrival_code==='0'){
      const n=Number(p.entering_doksan_minutes);
      if(Number.isFinite(n)&&n>=0){remaining=n;basis='entering_doksan_schedule';}
    }else{
      const n=Number((p.minutes_to_doksan_by_station||{})[candidate.current_location]);
      if(Number.isFinite(n)&&n>=0){remaining=n;basis=`schedule_from_${candidate.current_location}`;}
    }
    if(!Number.isFinite(remaining)) return null;
    return {
      boarding_at:addMinutes(observed,remaining),
      remaining_minutes:remaining,
      basis,
      position_data_source:'realtime',
      timing_data_source:'schedule',
      evidence:[
        {source:'api',text:`실시간 현재 위치/상태: ${candidate.arrival_message||candidate.current_location||'확인됨'}`},
        {source:'rule',text:'현재 위치부터 독산까지 시간표 역간 시간차를 누적해 탑승 ETA 계산'},
        {source:'constraint',text:'해당 위치의 시간표 구간값이 없으면 ETA를 임의 추정하지 않음'}
      ]
    };
  }

  function hybridOrigin(candidate,profile,plannedDepartureAt){
    const boarding=boardingEta(candidate,profile);
    if(!boarding) return null;
    const guro=Number(profile&&profile.doksan_to_guro_minutes);
    if(!Number.isFinite(guro)||guro<0) return null;
    const arrival=addMinutes(boarding.boarding_at,guro);
    return {
      id:candidate.btrainNo||null,
      btrainNo:candidate.btrainNo||null,
      direction_validated:true,
      departure_at:boarding.boarding_at,
      arrival_at:arrival,
      planned_departure_at:plannedDepartureAt||null,
      data_source:'realtime',
      position_data_source:'realtime',
      timing_data_source:'schedule',
      plan_deviation_minutes:plannedDepartureAt?minutesBetween(boarding.boarding_at,plannedDepartureAt):null,
      schedule_remaining_minutes:boarding.remaining_minutes,
      schedule_doksan_to_guro_minutes:guro,
      evidence:[
        ...(candidate.evidence||[]),
        ...boarding.evidence,
        {source:'rule',text:`독산→구로 ${guro}분은 시간표 역간 시간차 사용`}
      ]
    };
  }

  global.GallaeSchedulePositionETA={parseKst,addMinutes,minutesBetween,boardingEta,hybridOrigin};
})(typeof window!=='undefined'?window:globalThis);
