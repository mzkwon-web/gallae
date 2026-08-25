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

  const result = globalThis.GallaePhase2HybridRuntime.buildFromRows({
    rows:doksan.rows || [],
    schedule,
    policy,
    // These two values deliberately remain absent until evidence exists in repository data.
    planned_departure_at:null,
    final_access_minutes:null
  });

  const payload = {
    status:result.status,
    generated_at:new Date().toISOString(),
    input_updated_at:doksan.updated_at || null,
    source_priority:policy.data_priority,
    target_clock:policy.targets && policy.targets.target_arrival,
    deadline_clock:policy.targets && policy.targets.hard_deadline,
    scope:'Doksan realtime position + official KORAIL schedule through Sincheon',
    planned_departure_status:'missing_repository_evidence',
    final_access_status:'missing_repository_evidence',
    ...result
  };

  fs.mkdirSync(path.dirname(outputPath),{recursive:true});
  fs.writeFileSync(outputPath,JSON.stringify(payload,null,2),'utf8');
  process.stdout.write(JSON.stringify(payload,null,2)+'\n');

  if(!['ok','unavailable'].includes(payload.status)) process.exitCode=1;
}

main();
