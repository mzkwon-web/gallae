(function(global){
  'use strict';

  function asArray(value){
    return Array.isArray(value) ? value : [];
  }

  function normalize(value){
    return String(value == null ? '' : value).trim();
  }

  function routeIdentity(row){
    return {
      route_id: normalize(row && (row.busRouteId || row.route_id || row.routeId)),
      route_name: normalize(row && (row.rtNm || row.route_name || row.routeName)),
      station_id: normalize(row && (row.stId || row.station_id || row.stationId)),
      ars_id: normalize(row && (row.arsId || row.ars_id)),
      station_name: normalize(row && (row.stNm || row.station_name || row.stationName))
    };
  }

  function matchesVerifiedRoute(identity, rule){
    const routeIds = new Set(asArray(rule && rule.allowed_route_ids).map(normalize).filter(Boolean));
    const routeNames = new Set(asArray(rule && rule.allowed_route_names).map(normalize).filter(Boolean));
    if(routeIds.size && identity.route_id && routeIds.has(identity.route_id)) return true;
    if(routeNames.size && identity.route_name && routeNames.has(identity.route_name)) return true;
    return false;
  }

  function matchesVerifiedStation(identity, rule){
    const expectedArs = normalize(rule && rule.origin_ars_id);
    const expectedStationIds = new Set(asArray(rule && rule.origin_station_ids).map(normalize).filter(Boolean));
    if(expectedArs && identity.ars_id && identity.ars_id !== expectedArs) return false;
    if(expectedStationIds.size && identity.station_id && !expectedStationIds.has(identity.station_id)) return false;
    return true;
  }

  function classify(row, rule){
    const identity = routeIdentity(row);
    if(!matchesVerifiedStation(identity, rule)){
      return {eligible:false, reason:'origin_station_identity_mismatch', identity};
    }

    if(!rule || rule.enabled !== true){
      return {eligible:true, reason:'destination_filter_not_enabled', identity};
    }

    if(matchesVerifiedRoute(identity, rule)){
      return {eligible:true, reason:'verified_route_to_destination', identity};
    }

    return {eligible:false, reason:'route_not_verified_for_destination', identity};
  }

  function filterRows(rows, rule){
    return asArray(rows).filter(row => classify(row, rule).eligible);
  }

  const api = Object.freeze({routeIdentity, classify, filterRows});
  global.GallaeBusDestinationFilter = api;
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
