(function(global){
  'use strict';

  function serviceDateFromObserved(observedAt){
    const parsed = global.GallaeSchedulePositionETA && global.GallaeSchedulePositionETA.parseKst(observedAt);
    if(!parsed) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit'
    }).formatToParts(new Date(parsed));
    const values = Object.fromEntries(parts.map(p => [p.type,p.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function clockToKstIso(serviceDate, clock){
    const date = String(serviceDate || '').trim();
    const value = String(clock || '').trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
    const normalized = value.length === 5 ? `${value}:00` : value;
    return `${date}T${normalized}+09:00`;
  }

  function materializeConnections(items, serviceDate){
    return (items || []).map((item,index) => {
      const departureAt = clockToKstIso(serviceDate,item.departure);
      let arrivalDate = serviceDate;
      let arrivalAt = clockToKstIso(arrivalDate,item.arrival);
      if(departureAt && arrivalAt && Date.parse(arrivalAt) < Date.parse(departureAt)){
        const d = new Date(`${serviceDate}T00:00:00+09:00`);
        d.setUTCDate(d.getUTCDate()+1);
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit'
        }).formatToParts(d);
        const values = Object.fromEntries(parts.map(p => [p.type,p.value]));
        arrivalDate = `${values.year}-${values.month}-${values.day}`;
        arrivalAt = clockToKstIso(arrivalDate,item.arrival);
      }
      return {
        id:item.id || `schedule-${index+1}`,
        departure_at:departureAt,
        arrival_at:arrivalAt,
        data_source:item.data_source || 'schedule',
        evidence:[
          {source:'rule',text:'KORAIL 공식 시각표의 같은 열 출발·도착 시각을 연결편으로 사용'}
        ]
      };
    }).filter(item => item.departure_at && item.arrival_at);
  }

  function serviceProfileMatches(candidate,profile){
    const expected = String(profile && profile.service_type || '').trim();
    if(!expected) return true;
    return String(candidate && candidate.service_type || '').trim() === expected;
  }

  function targetIso(serviceDate,clock){
    return clockToKstIso(serviceDate,clock);
  }

  function subtractMinutes(value,minutes){
    const ms=Date.parse(value), n=Number(minutes);
    return Number.isFinite(ms)&&Number.isFinite(n)?new Date(ms-n*60000).toISOString():null;
  }

  function latestConnectionArrivingBy(connections,latestArrival){
    const cutoff=Date.parse(latestArrival);
    if(!Number.isFinite(cutoff)) return null;
    const available=(connections||[]).filter(item=>{
      const arrival=Date.parse(item&&item.arrival_at);
      return Number.isFinite(arrival)&&arrival<=cutoff;
    });
    if(!available.length) return null;
    const priorityOf=item=>{
      const key=String(item&&item.data_source||'estimate').toLowerCase();
      const priorities=(global.GallaeRollingETA&&global.GallaeRollingETA.DATA_PRIORITY)||{realtime:0,schedule:1,plan:1,estimate:2};
      return Object.prototype.hasOwnProperty.call(priorities,key)?priorities[key]:priorities.estimate;
    };
    const bestPriority=Math.min(...available.map(priorityOf));
    return available
      .filter(item=>priorityOf(item)===bestPriority)
      .sort((a,b)=>Date.parse(b.arrival_at)-Date.parse(a.arrival_at))[0]||null;
  }

  function derivePlannedOrigin(options){
    const schedule=options&&options.schedule;
    const serviceDate=options&&options.service_date;
    const targetAt=options&&options.target_at;
    const finalAccessMinutes=Number(options&&options.final_access_minutes);
    if(!schedule||!serviceDate||!targetAt||!Number.isFinite(finalAccessMinutes)||finalAccessMinutes<0){
      return null;
    }
    const guroMinutes=Number(schedule.doksan_position_profile&&schedule.doksan_position_profile.doksan_to_guro_minutes);
    if(!Number.isFinite(guroMinutes)||guroMinutes<0) return null;

    const scheduleInput={
      guro_to_sosa:materializeConnections(schedule.guro_to_sosa,serviceDate),
      sosa_to_sincheon:materializeConnections(schedule.sosa_to_sincheon,serviceDate)
    };
    const latestSincheonArrival=subtractMinutes(targetAt,finalAccessMinutes);
    const sosaSincheon=latestConnectionArrivingBy(scheduleInput.sosa_to_sincheon,latestSincheonArrival);
    if(!sosaSincheon) return null;
    const guroSosa=latestConnectionArrivingBy(scheduleInput.guro_to_sosa,sosaSincheon.departure_at);
    if(!guroSosa) return null;
    const plannedDepartureAt=subtractMinutes(guroSosa.departure_at,guroMinutes);
    if(!plannedDepartureAt) return null;

    return {
      planned_departure_at:plannedDepartureAt,
      target_at:targetAt,
      latest_sincheon_arrival:latestSincheonArrival,
      guro_to_sosa:guroSosa,
      sosa_to_sincheon:sosaSincheon,
      doksan_to_guro_minutes:guroMinutes,
      final_access_minutes:finalAccessMinutes,
      data_source:'schedule',
      evidence:[
        {source:'rule',text:'13:50 목표에서 최종 접근시간을 빼고, 소사→신천 및 구로→소사 연결편을 역순으로 선택해 계획 독산 탑승시각 계산'},
        {source:'rule',text:'계획 시각은 공식 시간표 기반 초기 계획/출발 역산에만 사용하고 실시간 이동 판단은 현재 이용 가능한 열차를 우선'}
      ]
    };
  }

  function coverageContains(coverage,serviceDate,value){
    if(!coverage || coverage.complete_within_window !== true) return false;
    const current=Date.parse(value);
    const start=Date.parse(clockToKstIso(serviceDate,coverage.start));
    const end=Date.parse(clockToKstIso(serviceDate,coverage.end));
    return Number.isFinite(current)&&Number.isFinite(start)&&Number.isFinite(end)&&current>=start&&current<=end;
  }

  function buildRuntimeCandidate(options){
    const deps = {
      input:global.GallaePhase2HybridInput,
      position:global.GallaeSchedulePositionETA,
      rolling:global.GallaeRollingETA
    };
    if(!deps.input || !deps.position || !deps.rolling){
      return {status:'unavailable',reason:'phase2_runtime_dependency_missing'};
    }
    const candidate = options && options.candidate;
    const schedule = options && options.schedule;
    const policy = options && options.policy;
    if(!candidate || !schedule){
      return {status:'unavailable',reason:'candidate_or_schedule_missing'};
    }
    const profile = schedule.doksan_position_profile || {};
    if(!serviceProfileMatches(candidate,profile)){
      return {
        status:'unavailable',reason:'schedule_profile_service_type_mismatch',
        service_type:candidate.service_type || null,
        required_service_type:profile.service_type || null
      };
    }
    const serviceDate = serviceDateFromObserved(candidate.observed_at);
    if(!serviceDate) return {status:'unavailable',reason:'service_date_unknown'};

    const journeyProfile=(policy&&policy.journey_profile)||{};
    const configuredFinalAccess=journeyProfile.final_access&&Number(journeyProfile.final_access.minutes);
    const finalAccessMinutes=options.final_access_minutes == null
      ? (Number.isFinite(configuredFinalAccess)?configuredFinalAccess:null)
      : Number(options.final_access_minutes);
    const targetClock = options.target_clock || (policy && policy.targets && policy.targets.target_arrival) || '13:50';
    const deadlineClock = options.deadline_clock || (policy && policy.targets && policy.targets.hard_deadline) || '14:00';
    const targetAt = targetIso(serviceDate,targetClock);
    const deadlineAt = targetIso(serviceDate,deadlineClock);
    const plannedOrigin = options.planned_departure_at ? null : derivePlannedOrigin({
      schedule,
      service_date:serviceDate,
      target_at:targetAt,
      final_access_minutes:finalAccessMinutes
    });
    const plannedDepartureAt = options.planned_departure_at || (plannedOrigin&&plannedOrigin.planned_departure_at) || null;
    const origin = deps.position.hybridOrigin(candidate,profile,plannedDepartureAt);
    if(!origin) return {status:'unavailable',reason:'doksan_boarding_eta_unavailable'};

    const snapshotAt = options.snapshot_at || null;
    const snapshotMs = snapshotAt ? Date.parse(snapshotAt) : NaN;
    const boardingMs = Date.parse(origin.departure_at);
    if(Number.isFinite(snapshotMs) && Number.isFinite(boardingMs) && boardingMs < snapshotMs){
      return {
        status:'unavailable',
        reason:'boarding_eta_before_snapshot',
        departure_at:origin.departure_at,
        snapshot_at:snapshotAt,
        stale_by_minutes:Math.round(((snapshotMs-boardingMs)/60000)*10)/10
      };
    }

    const scheduleInput = {
      guro_to_sosa:materializeConnections(schedule.guro_to_sosa,serviceDate),
      sosa_to_sincheon:materializeConnections(schedule.sosa_to_sincheon,serviceDate)
    };
    const coverage=schedule.coverage||{};
    if(!coverageContains(coverage.guro_to_sosa,serviceDate,origin.arrival_at)){
      return {
        status:'unavailable',
        reason:'guro_schedule_outside_verified_coverage',
        guro_arrival_at:origin.arrival_at,
        coverage:coverage.guro_to_sosa||null
      };
    }
    const firstGuroConnection=deps.rolling.nextConnection(scheduleInput.guro_to_sosa,origin.arrival_at);
    if(!firstGuroConnection){
      return {status:'unavailable',reason:'no_guro_to_sosa_connection_in_verified_coverage'};
    }
    const sosaArrival=firstGuroConnection.arrival_at;
    if(!coverageContains(coverage.sosa_to_sincheon,serviceDate,sosaArrival)){
      return {
        status:'unavailable',
        reason:'sosa_schedule_outside_verified_coverage',
        sosa_arrival_at:sosaArrival,
        coverage:coverage.sosa_to_sincheon||null
      };
    }

    const finalAccessEvidence=journeyProfile.final_access&&journeyProfile.final_access.evidence
      ? [{source:journeyProfile.final_access.source||'measured',text:journeyProfile.final_access.evidence}]
      : [];
    const hybrid = deps.input.buildHybridInput({
      id:options.id || `doksan-hybrid-${candidate.btrainNo || 'unknown'}`,
      origin,
      schedule:scheduleInput,
      target_at:targetAt,
      deadline_at:deadlineAt,
      final_access_minutes:finalAccessMinutes == null ? 0 : finalAccessMinutes,
      transfer_score:options.transfer_score || 0,
      stability_score:options.stability_score || 0,
      preference_score:options.preference_score || 0,
      evidence:[
        {source:'api',text:'독산 현재 이용 가능 열차 위치는 서울시 실시간 도착정보 사용'},
        {source:'rule',text:'독산 이후 실시간 미확보 구간은 KORAIL 공식 시간표 연결편으로 rolling'},
        {source:'constraint',text:'정적 시간표 데이터의 검증된 coverage 밖에서는 다음 연결편을 임의 선택하지 않음'},
        ...finalAccessEvidence,
        ...(finalAccessMinutes == null ? [{source:'constraint',text:'신천 이후 최종 접근시간 근거가 없어 현재 final_eta는 신천 도착시각 기준의 부분 ETA'}] : [])
      ]
    });
    if(hybrid.status !== 'ok') return hybrid;
    const result = deps.rolling.buildCandidate(hybrid.input);
    return {
      ...result,
      service_date:serviceDate,
      snapshot_at:snapshotAt,
      eta_scope:finalAccessMinutes == null ? 'through_sincheon' : 'final_destination',
      plan_deviation_status:plannedDepartureAt ? (plannedOrigin?'derived_from_schedule_plan':'available') : 'planned_departure_missing',
      planned_origin:plannedOrigin,
      final_access_source:finalAccessMinutes == null ? null : (journeyProfile.final_access&&journeyProfile.final_access.source)||'measured',
      schedule_provenance:schedule.provenance || null
    };
  }

  function buildFromRows(options){
    const rows = options && options.rows || [];
    const input = global.GallaePhase2HybridInput;
    if(!input) return {status:'unavailable',reason:'phase2_input_dependency_missing',candidates:[]};
    const realtimeCandidates = input.selectDoksanGuroCandidates(rows);
    const policy=options&&options.policy||{};
    const schedule=options&&options.schedule||{};
    const journeyProfile=policy.journey_profile||{};
    const configuredFinalAccess=journeyProfile.final_access&&Number(journeyProfile.final_access.minutes);
    const finalAccessMinutes=options.final_access_minutes == null
      ? (Number.isFinite(configuredFinalAccess)?configuredFinalAccess:null)
      : Number(options.final_access_minutes);
    const planServiceDate=realtimeCandidates.length?serviceDateFromObserved(realtimeCandidates[0].observed_at):null;
    const targetClock=options.target_clock||(policy.targets&&policy.targets.target_arrival)||'13:50';
    const plannedOrigin=planServiceDate?derivePlannedOrigin({
      schedule,
      service_date:planServiceDate,
      target_at:targetIso(planServiceDate,targetClock),
      final_access_minutes:finalAccessMinutes
    }):null;
    const built = realtimeCandidates.map(candidate => ({
      realtime:candidate,
      result:buildRuntimeCandidate({...options,candidate,planned_departure_at:options.planned_departure_at||(plannedOrigin&&plannedOrigin.planned_departure_at)||null})
    }));
    const usable = built.filter(item => item.result && item.result.status === 'ok');
    const ranked = global.GallaeRollingETA ? global.GallaeRollingETA.rankCandidates(usable.map(item => item.result)) : [];
    return {
      status:usable.length ? 'ok' : 'unavailable',
      realtime_candidate_count:realtimeCandidates.length,
      usable_candidate_count:usable.length,
      planned_origin:plannedOrigin,
      final_access_minutes:finalAccessMinutes,
      candidates:built,
      ranked
    };
  }

  global.GallaePhase2HybridRuntime={
    serviceDateFromObserved,
    clockToKstIso,
    materializeConnections,
    subtractMinutes,
    latestConnectionArrivingBy,
    derivePlannedOrigin,
    serviceProfileMatches,
    coverageContains,
    buildRuntimeCandidate,
    buildFromRows
  };
})(typeof window!=='undefined'?window:globalThis);
