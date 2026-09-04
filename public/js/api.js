(function () {
  'use strict';

  // Same-origin so scratch ports (e.g. PORT=4097) and restarts keep UI ↔ API wired.
  var BASE_URL = '';

  async function request(method, path, body) {
    var opts = {
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }
    var res = await fetch(BASE_URL + path, opts);
    if (!res.ok) {
      var err;
      try { err = await res.json(); } catch (e) { err = { error: res.statusText }; }
      throw new Error(err.error || err.message || res.statusText || 'Request failed');
    }
    if (res.status === 204) return null;
    return res.json();
  }

  window.API = {
    /* Health */
    getHealth:       function () { return request('GET', '/api/health'); },
    getHealthOllama: function () { return request('GET', '/api/health/ollama'); },

    /* Scenarios */
    getScenarios:   function ()      { return request('GET',    '/api/scenarios'); },
    getScenario:    function (id)    { return request('GET',    '/api/scenarios/' + id); },
    createScenario: function (data)  { return request('POST',   '/api/scenarios', data); },
    updateScenario: function (id, d) { return request('PUT',    '/api/scenarios/' + id, d); },
    deleteScenario: function (id)    { return request('DELETE', '/api/scenarios/' + id); },

    /* Characters — global */
    getCharacters:   function ()      { return request('GET',    '/api/characters'); },
    getCharacter:    function (id)    { return request('GET',    '/api/characters/' + id); },
    createCharacter: function (data)  { return request('POST',   '/api/characters', data); },
    updateCharacter: function (id, d) { return request('PUT',    '/api/characters/' + id, d); },
    deleteCharacter: function (id)    { return request('DELETE', '/api/characters/' + id); },
    updateCharacterClothing: function (charId, d) {
      // CF-10: when d.scenario_id is set, d.runtime must be an explicit boolean
      return request('PATCH', '/api/characters/' + charId + '/clothing', d);
    },

    /* Scenario ↔ Character roster */
    getScenarioCharacters:       function (sid)         { return request('GET',    '/api/scenarios/' + sid + '/characters'); },
    addCharacterToScenario:      function (sid, charId, opts) {
      return request('POST', '/api/scenarios/' + sid + '/characters/' + charId, opts || {});
    },
    setScenarioCharacterClothing: function (sid, charId, opts) {
      // CF-10: body.runtime must be an explicit boolean (true=runtime, false=starting)
      var body = opts || {};
      if (typeof opts === 'string') body = { clothing: opts };
      return request('PATCH', '/api/scenarios/' + sid + '/characters/' + charId + '/clothing', body);
    },
  removeCharacterFromScenario: function (sid, charId) { return request('DELETE', '/api/scenarios/' + sid + '/characters/' + charId); },

    getScenarioCharacterStates:   function (sid) { return request('GET', '/api/scenarios/' + sid + '/character-states'); },
    updateScenarioCharacterState: function (sid, charId, d) { return request('PUT', '/api/scenarios/' + sid + '/character-states/' + charId, d); },

    /* Locations — global */
    getLocations:    function ()       { return request('GET',    '/api/locations'); },
    getLocation:     function (sid, id){ return request('GET',    '/api/scenarios/' + sid + '/locations/' + id); },
    createLocation:  function (data)   { return request('POST',   '/api/locations', data); },
    updateLocation:  function (id, d)  { return request('PUT',    '/api/locations/' + id, d); },
    deleteLocation:  function (id)     { return request('DELETE', '/api/locations/' + id); },

    /* Locations — scenario membership */
    getScenarioLocations:       function (sid)        { return request('GET',    '/api/scenarios/' + sid + '/locations'); },
    addLocationToScenario:      function (sid, locId) { return request('POST',   '/api/scenarios/' + sid + '/locations/' + locId + '/add'); },
    removeLocationFromScenario: function (sid, locId) { return request('DELETE', '/api/scenarios/' + sid + '/locations/' + locId + '/remove'); },
    setScenarioActiveLocation:   function (sid, locId) { return request('PUT',    '/api/scenarios/' + sid, { active_location_id: locId }); },
    clearScenarioActiveLocation: function (sid)        { return request('PUT',    '/api/scenarios/' + sid, { active_location_id: null }); },
    setScenarioActivePlace:      function (sid, text)  { return request('PUT',    '/api/scenarios/' + sid, { active_place_text: text }); },
    clearScenarioPlace:          function (sid)        { return request('PUT',    '/api/scenarios/' + sid, { active_location_id: null, active_place_text: '' }); },
    getScenarioActiveLocation:   function (sid)        {
      return request('GET', '/api/scenarios/' + sid).then(function (d) {
        return { active_location_id: (d.scenario || d).active_location_id || null };
      });
    },

    /* Character Relationships — global */
    getRelationshipTypes:    function ()       { return request('GET',    '/api/relationships/types'); },
    getRelationships:        function ()       { return request('GET',    '/api/relationships'); },
    createRelationship:      function (data)   { return request('POST',   '/api/relationships', data); },
    updateRelationship:      function (id, d)  { return request('PUT',    '/api/relationships/' + id, d); },
    deleteRelationship:      function (id)     { return request('DELETE', '/api/relationships/' + id); },

    /* Character bonds (per-character view of global relationships) */
    getCharacterBonds:   function (charId)       { return request('GET',    '/api/characters/' + charId + '/relationships'); },
    createCharacterBond: function (charId, data) { return request('POST',   '/api/relationships', Object.assign({ from_character_id: charId }, data)); },
    deleteCharacterBond: function (charId, id)   { return request('DELETE', '/api/relationships/' + id); },

    /* Scenario relationship overrides */
    getScenarioRelationships:    function (sid)       { return request('GET',    '/api/scenarios/' + sid + '/relationships'); },
    createScenarioRelationship:  function (sid, data) { return request('POST',   '/api/scenarios/' + sid + '/relationships', data); },
    updateScenarioRelationship:  function (sid, relId, data) { return request('PUT', '/api/scenarios/' + sid + '/relationships/' + relId, data); },
    deleteScenarioRelationship:  function (sid, relId) { return request('DELETE', '/api/scenarios/' + sid + '/relationships/' + relId); },
    updateCharacterBond:         function (charId, id, data) { return request('PUT', '/api/relationships/' + id, data); },

    /* Turns — scenario-scoped */
    getTurns:   function (sid)                { return request('GET',    '/api/scenarios/' + sid + '/turns'); },
    postTurn:   function (sid, contentText)   { return request('POST',   '/api/scenarios/' + sid + '/turns', { role: 'user', content_text: contentText }); },
    deleteTurn: function (sid, turnId)        { return request('DELETE', '/api/scenarios/' + sid + '/turns/' + turnId); },
    regenerateTurn: function (sid, turnId, body) { return request('POST', '/api/scenarios/' + sid + '/turns/' + turnId + '/regenerate', body || {}); },
    getShotAction:      function (sid, turnId, options) { var q = options ? '?mode=' + encodeURIComponent(options.mode || 'scene') + (options.characterId ? '&characterId=' + encodeURIComponent(options.characterId) : '') : ''; return request('GET', '/api/scenarios/' + sid + '/turns/' + turnId + '/shot-action' + q); },
    saveShotActionDraft:function (sid, turnId, body) { return request('PUT', '/api/scenarios/' + sid + '/turns/' + turnId + '/shot-action', typeof body === 'object' ? body : { text: body }); },
    suggestShotAction:  function (sid, turnId, body) { return request('POST', '/api/scenarios/' + sid + '/turns/' + turnId + '/shot-action/suggest', body || {}); },

    /* Memories — scenario-scoped */
    getMemories:        function (sid)          { return request('GET',    '/api/scenarios/' + sid + '/memories'); },
    createManualMemory: function (sid, content) { return request('POST',   '/api/scenarios/' + sid + '/memories', { content: content, memory_type: 'manual' }); },
    deleteMemory:       function (sid, memId)   { return request('DELETE', '/api/scenarios/' + sid + '/memories/' + memId); },

    /* World entries — scenario-scoped */
    getWorldEntries:  function (sid)        { return request('GET',    '/api/scenarios/' + sid + '/world'); },
    createWorldEntry: function (sid, data)  { return request('POST',   '/api/scenarios/' + sid + '/world', data); },
    updateWorldEntry: function (sid, id, d) { return request('PUT',    '/api/scenarios/' + sid + '/world/' + id, d); },
    deleteWorldEntry: function (sid, id)    { return request('DELETE', '/api/scenarios/' + sid + '/world/' + id); },

    /* Rules — scenario-scoped */
    getRules:   function (sid)        { return request('GET',    '/api/scenarios/' + sid + '/rules'); },
    createRule: function (sid, data)  { return request('POST',   '/api/scenarios/' + sid + '/rules', data); },
    updateRule: function (sid, id, d) { return request('PUT',    '/api/scenarios/' + sid + '/rules/' + id, d); },
    deleteRule: function (sid, id)    { return request('DELETE', '/api/scenarios/' + sid + '/rules/' + id); },

    /* Global config */
    getConfig:  function ()         { return request('GET',  '/api/config'); },
    setConfig:  function (key, val) { return request('POST', '/api/config', { key: key, value: val }); },
    setConfigs: function (map) {
      var configs = Object.keys(map).map(function (k) { return { key: k, value: map[k] }; });
      return request('POST', '/api/config/batch', { configs: configs });
    },

    /* LLM backend config (narrator/extractor/summarizer/picker per-role) */
    getLlamacppConfig: function () {
      return request('GET', '/api/config').then(function (cfg) {
        try { return JSON.parse(cfg.llamacpp_config || '{}'); } catch (_) { return {}; }
      });
    },
    saveLlamacppConfig: function (newCfg) {
      return request('POST', '/api/config', { key: 'llamacpp_config', value: JSON.stringify(newCfg) });
    },

    /* Audit log */
    getAuditLog: function (filters) {
      var qs = Object.keys(filters || {}).map(function (k) { return k + '=' + encodeURIComponent(filters[k]); }).join('&');
      return request('GET', '/api/audit' + (qs ? '?' + qs : ''));
    },
    getAuditRun: function (runId) { return request('GET', '/api/audit/' + runId); },

    /* A1111 health + catalog */
    getHealthA1111:   function ()      { return request('GET',  '/api/health/a1111'); },
    getA1111Status:   function ()      { return request('GET',  '/api/a1111/status'); },
    getA1111Progress: function ()      { return request('GET',  '/api/a1111/progress'); },
    getA1111Models:   function ()      { return request('GET',  '/api/a1111/models'); },
    getA1111Loras:    function ()      { return request('GET',  '/api/a1111/loras'); },
    getA1111Samplers: function ()      { return request('GET',  '/api/a1111/samplers'); },
    getA1111Vaes:       function ()  { return request('GET', '/api/a1111/vaes'); },
    getA1111Schedulers: function ()  { return request('GET', '/api/a1111/schedulers'); },
    getA1111FaceIdOptions: function () { return request('GET', '/api/a1111/controlnet/faceid-options'); },
    setA1111FaceIdConfig: function (config) { return request('PUT', '/api/a1111/controlnet/faceid-config', config); },
    getA1111PoseOptions: function () { return request('GET', '/api/a1111/controlnet/pose-options'); },
    setA1111PoseConfig: function (config) { return request('PUT', '/api/a1111/controlnet/pose-config', config); },
    setA1111Model:    function (name)  { return request('POST', '/api/a1111/model', { model_name: name }); },

    /* Prepared pose library — metadata and previews only; control images remain server-side. */
    getPoseLibrary: function () { return request('GET', '/api/poses'); },

    /* Looks (style lock) — exactly one active at a time */
    getLooks:       function ()      { return request('GET',    '/api/looks'); },
    getActiveLook:  function ()      { return request('GET',    '/api/looks/active'); },
    getLook:        function (id)    { return request('GET',    '/api/looks/' + id); },
    createLook:     function (data)  { return request('POST',   '/api/looks', data); },
    updateLook:     function (id, d) { return request('PUT',    '/api/looks/' + id, d); },
    deleteLook:     function (id)    { return request('DELETE', '/api/looks/' + id); },
    activateLook:   function (id)    { return request('POST',   '/api/looks/' + id + '/activate'); },
    createLookDraft: function (lookId) {
      return lookId ? request('POST', '/api/looks/' + lookId + '/drafts') : request('POST', '/api/looks/drafts');
    },
    saveLookDraft: function (draftId, data) { return request('PUT', '/api/looks/drafts/' + draftId, data); },
    discardLookDraft: function (draftId) { return request('DELETE', '/api/looks/drafts/' + draftId); },
    activateLookDraft: function (draftId) { return request('POST', '/api/looks/drafts/' + draftId + '/activate'); },
    testGenerateLookDraft: function (draftId, data) { return request('POST', '/api/looks/drafts/' + draftId + '/test-generate', data); },
    testGenerateLook:      function (draft)     { return request('POST', '/api/looks/test-generate', draft); },
    saveTestLookImage:     function (filename)   { return request('POST', '/api/looks/test-generate/save', { filename }); },
    cleanupTestLookImages: function (filenames) { return request('POST', '/api/looks/test-generate/cleanup', { filenames }); },

    /* Character FaceID reference image */
    setCharacterFaceRef:   function (charId, imageBase64, mime) {
      return request('POST', '/api/characters/' + charId + '/face-ref', { image_base64: imageBase64, mime: mime });
    },
    clearCharacterFaceRef: function (charId) { return request('DELETE', '/api/characters/' + charId + '/face-ref'); },

    /* Image generation — on-command only, one pipeline for scene/portrait/fullbody */
    getImages:         function (sid, turnId) {
      return request('GET', '/api/scenarios/' + sid + '/images' + (turnId ? '?turnId=' + turnId : ''));
    },
    generateImage:      function (sid, opts) { return request('POST', '/api/scenarios/' + sid + '/images/generate', opts || {}); },
    warmupImage:        function (sid, opts) { return request('POST', '/api/scenarios/' + sid + '/images/warmup', opts || {}); },
    acceptImage:         function (sid, imageId) { return request('PUT', '/api/scenarios/' + sid + '/images/' + imageId + '/accept'); },
    rateImage:            function (sid, imageId, rating) { return request('PUT', '/api/scenarios/' + sid + '/images/' + imageId + '/rate', { rating: rating }); },
    deleteImage:          function (sid, imageId) { return request('DELETE', '/api/scenarios/' + sid + '/images/' + imageId); },
  };
})();
