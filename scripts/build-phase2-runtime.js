'use strict';

const fs = require('fs');
const path = require('path');

require('../lib/phase2-hybrid-input.js');
require('../lib/schedule-position-eta.js');
require('../lib/rolling-eta.js');
require('../lib/phase2-hybrid-runtime.js');

function readJson(file){
  return JSON.parse(fs.readFileSync(file,'utf8'));
}

function classifyValidationWindow(snapshotAt, plannedDepartureAt, config){
  const snapshotMs = Date.parse(snapshotAt || '');
  const plannedMs = Date.parse(plannedDepartureAt || '');
  const before = Number(config && config.before_planned_departure_minutes);
  const after = Number(config && config.after_planned_departure_minutes);
  if(!Number.isFinite(snapshotMs) || !Number.isFinite(plannedMs) || !Number.isFinite(before) || !Number.isFinite(after)){
    return {
      status:'unavailable',
      delta_from_planned_minutes:null,
      window_start_at:null,
      window_end_at:null,
      evidence:[{source:'constraint',text:'계획 출발시각 또는 runtime validation window 근거가 없어 운영 검증창을 판정하지 않음'}]
    };
  }
  const delta = (snapshotMs - plannedMs) / 60000;
  const start = new Date(plannedMs - before * 60000).toISOString();
  const end = new Date(plannedMs + after * 60000).toISOString();
  const status = delta < -before ? 'before' : delta > after ? 'after' : 'within';
  return {
    status,
    delta_from_planned_minutes:Math.round(delta * 10) / 10,
    window_start_at:start,
    window_end_at:end,
    evidence:[
      {source:'rule',text:'실제 출발 판단용 plan_deviation은 계획 독산 탑승시각 전후의 검증창 내 snapshot을 우선 사용'},
      ...(status === 'within' ? [] : [{source:'constraint',text:'현재 snapshot은 운영 검증창 밖이므로 계산 결과를 회귀/구조 검증용으로만 취급'}])
    ]
  };
}

function main(){
  const root = path.resolve(__dirname,'..');
  const doksanPath = process.argv[2] || path.join(root,'data','doksan-line1.json');
  const outputPath = process.argv[3] || path.join(root,'data','phase2-runtime.json');
  const schedule = readJson(path.join(root,'data','phase2-schedule.json'));
  const policy = readJson(path.join(root,'config','phase2-hybrid.json'));
  const doksan = readJson(doksanPath);

  const journeyProfile = policy.journey_profile || {};
  const finalAccess = journeyProfile.final_access || {};
  const finalAccessMinutes = Number.isFinite(Number(finalAccess.minutes)) ? Number(finalAccess.minutes) : null;

  const result = globalThis.GallaePhase2HybridRuntime.buildFromRows({
    rows:doksan.rows || [],
    schedule,
    policy,
    snapshot_at:doksan.updated_at || null,
    planned_departure_at:null,
    final_access_minutes:finalAccessMinutes
  });

  const derivedPlan = result.planned_origin || null;
  const plannedDepartureAt = derivedPlan && derivedPlan.planned_departure_at || null;
  const operationalValidation = classifyValidationWindow(
    doksan.updated_at || null,
    plannedDepartureAt,
    policy.runtime_validation_window || null
  );

  const payload = {
    status:result.status,
    generated_at:new Date().toISOString(),
    input_updated_at:doksan.updated_at || null,
    source_priority:policy.data_priority,
    target_clock:policy.targets && policy.targets.target_arrival,
    deadline_clock:policy.targets && policy.targets.hard_deadline,
    scope:finalAccessMinutes == null
      ? 'Doksan realtime position + official KORAIL schedule through Sincheon'
      : 'Doksan realtime position + official KORAIL schedule + measured final access to destination',
    journey_destination:journeyProfile.destination || null,
    planned_departure_status:derivedPlan ? 'derived_from_schedule_plan' : 'unavailable',
    planned_departure_at:plannedDepartureAt,
    operational_validation:operationalValidation,
    final_access_status:finalAccessMinutes == null ? 'missing_repository_evidence' : 'available',
    final_access_minutes:finalAccessMinutes,
    final_access_source:finalAccess.source || null,
    ...result
  };

  fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  fs.writeFileSync(outputPath,JSON.stringify(payload,null,2),'utf8');
  process.stdout.write(JSON.stringify(payload,null,2)+'\n');

  if(!['ok','unavailable'].includes(payload.status)) process.exitCode=1;
}

main();
