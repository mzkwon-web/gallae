(function(global){
  'use strict';

  const TYPES = Object.freeze([
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

  function isValid(source){
    return TYPES.includes(String(source || ''));
  }

  global.GallaeSourceTypes = {TYPES, LABELS, isValid};
})(typeof window !== 'undefined' ? window : globalThis);
