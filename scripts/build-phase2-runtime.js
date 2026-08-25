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
    planned_departure_at:derivedPlan && derivedPlan.planned_departure_at || null,
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
