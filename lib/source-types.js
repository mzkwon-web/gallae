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
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
