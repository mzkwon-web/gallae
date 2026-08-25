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

    const plannedDepartureAt = options.planned_departure_at || null;
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

    const targetClock = options.target_clock || (policy && policy.targets && policy.targets.target_arrival) || '13:50';
    const deadlineClock = options.deadline_clock || (policy && policy.targets && policy.targets.hard_deadline) || '14:00';
    const targetAt = targetIso(serviceDate,targetClock);
    const deadlineAt = targetIso(serviceDate,deadlineClock);
    const hybrid = deps.input.buildHybridInput({
      id:options.id || `doksan-hybrid-${candidate.btrainNo || 'unknown'}`,
      origin,
      schedule:scheduleInput,
      target_at:targetAt,
      deadline_at:deadlineAt,
      final_access_minutes:options.final_access_minutes == null ? 0 : Number(options.final_access_minutes),
      transfer_score:options.transfer_score || 0,
      stability_score:options.stability_score || 0,
      preference_score:options.preference_score || 0,
      evidence:[
        {source:'api',text:'독산 현재 이용 가능 열차 위치는 서울시 실시간 도착정보 사용'},
        {source:'rule',text:'독산 이후 실시간 미확보 구간은 KORAIL 공식 시간표 연결편으로 rolling'},
        {source:'constraint',text:'정적 시간표 데이터의 검증된 coverage 밖에서는 다음 연결편을 임의 선택하지 않음'},
        ...(options.final_access_minutes == null ? [{source:'constraint',text:'신천 이후 최종 접근시간 근거가 없어 현재 final_eta는 신천 도착시각 기준의 부분 ETA'}] : [])
      ]
    });
    if(hybrid.status !== 'ok') return hybrid;
    const result = deps.rolling.buildCandidate(hybrid.input);
    return {
      ...result,
      service_date:serviceDate,
      snapshot_at:snapshotAt,
      eta_scope:options.final_access_minutes == null ? 'through_sincheon' : 'final_destination',
      plan_deviation_status:plannedDepartureAt ? 'available' : 'planned_departure_missing',
      schedule_provenance:schedule.provenance || null
    };
  }

  function buildFromRows(options){
    const rows = options && options.rows || [];
    const input = global.GallaePhase2HybridInput;
    if(!input) return {status:'unavailable',reason:'phase2_input_dependency_missing',candidates:[]};
    const realtimeCandidates = input.selectDoksanGuroCandidates(rows);
    const built = realtimeCandidates.map(candidate => ({
      realtime:candidate,
      result:buildRuntimeCandidate({...options,candidate})
    }));
    const usable = built.filter(item => item.result && item.result.status === 'ok');
    const ranked = global.GallaeRollingETA ? global.GallaeRollingETA.rankCandidates(usable.map(item => item.result)) : [];
    return {
      status:usable.length ? 'ok' : 'unavailable',
      realtime_candidate_count:realtimeCandidates.length,
      usable_candidate_count:usable.length,
      candidates:built,
      ranked
    };
  }

  global.GallaePhase2HybridRuntime={
    serviceDateFromObserved,
    clockToKstIso,
    materializeConnections,
    serviceProfileMatches,
    coverageContains,
    buildRuntimeCandidate,
    buildFromRows
  };
})(typeof window!=='undefined'?window:globalThis);
