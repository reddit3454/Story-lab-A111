(function () {
  'use strict';

  var BASE_URL = 'http://localhost:4090';

  async function upload(path, formData) {
    var res = await fetch(BASE_URL + path, { method: 'POST', body: formData });
    if (!res.ok) {
      var err;
      try { err = await res.json(); } catch (e) { err = { error: res.statusText }; }
      throw new Error(err.error || err.message || res.statusText || 'Upload failed');
    }
    if (res.status === 204) return null;
    return res.json();
  }

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
    getHealthA1111:  function () { return request('GET', '/api/health/a1111'); },
    freeVram:        function () { return request('POST', '/api/health/free-vram'); },

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

    /* Character References & Full-Body Images */
    getReferences:      function (charId)        { return request('GET',    '/api/characters/' + charId + '/references'); },
    generateReference:  function (charId, body)  { return request('POST',   '/api/characters/' + charId + '/references/generate', body || {}); },
    uploadReference:    function (charId, file)  { var fd = new FormData(); fd.append('file', file); return upload('/api/characters/' + charId + '/references/upload', fd); },
    acceptReference:    function (charId, ref)   { return request('POST',   '/api/characters/' + charId + '/references/' + encodeURIComponent(ref) + '/accept'); },
    deleteReference:    function (charId, refId) { return request('DELETE', '/api/characters/' + charId + '/references/' + refId); },
    clearFaceId:        function (charId)        { return request('DELETE', '/api/characters/' + charId + '/references/faceid'); },
    getFullbodies:      function (charId)        { return request('GET',    '/api/characters/' + charId + '/fullbody'); },
    generateFullbody:   function (charId, body)  { return request('POST',   '/api/characters/' + charId + '/fullbody/generate', body || {}); },
    deleteFullbody:     function (charId, fbId)  { return request('DELETE', '/api/characters/' + charId + '/fullbody/' + fbId); },
    setDefaultFullbody: function (charId, fbId)  { return request('POST',   '/api/characters/' + charId + '/fullbody/' + fbId + '/set-default'); },
    saveFaceIdConfig:   function (charId, data)  { return request('PATCH',  '/api/characters/' + charId + '/faceid-config', data); },
    useFullbodyAsRef:   function (charId, fbId)  { return request('POST',   '/api/characters/' + charId + '/fullbody/' + fbId + '/use-as-ref'); },

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
    getScenarioActiveLocation:   function (sid)        {
      return request('GET', '/api/scenarios/' + sid).then(function (d) {
        return { active_location_id: (d.scenario || d).active_location_id || null };
      });
    },

    /* Location backgrounds — global DB-driven */
    getLocationBackgrounds:       function (locId)           { return request('GET',    '/api/locations/' + locId + '/backgrounds'); },
    addLocationBackground:        function (locId, filename) { return request('POST',   '/api/locations/' + locId + '/backgrounds', { filename: filename }); },
    deleteLocationBackground:     function (locId, bgId)     { return request('DELETE', '/api/locations/' + locId + '/backgrounds/' + bgId); },
    setDefaultLocationBackground: function (locId, bgId)     { return request('POST',   '/api/locations/' + locId + '/backgrounds/' + bgId + '/set-default'); },

    /* Background generation — still scenario-scoped */
    generateLocationBackground: function (sid, locId) { return request('POST', '/api/scenarios/' + sid + '/locations/' + locId + '/generate-background'); },

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

    /* Turns — scenario-scoped */
    getTurns:   function (sid)                { return request('GET',    '/api/scenarios/' + sid + '/turns'); },
    postTurn:   function (sid, contentText)   { return request('POST',   '/api/scenarios/' + sid + '/turns', { role: 'user', content_text: contentText }); },
    deleteTurn: function (sid, turnId)        { return request('DELETE', '/api/scenarios/' + sid + '/turns/' + turnId); },
    patchSceneSummary: function (sid, turnId, body) { return request('PATCH', '/api/scenarios/' + sid + '/turns/' + turnId + '/scene-summary', body); },
    getSummaryHistory: function (sid, turnId) { return request('GET', '/api/scenarios/' + sid + '/turns/' + turnId + '/summary-history'); },
    postRegenerateTags: function (sid, turnId, body) { return request('POST', '/api/scenarios/' + sid + '/turns/' + turnId + '/regenerate-tags', body || {}); },

    /* Images — scenario-scoped */
    getImages: function (sid, turnId) {
      var qs = turnId ? '?turn_id=' + turnId : '';
      return request('GET', '/api/scenarios/' + sid + '/images' + qs);
    },
    postPromptPreview: function (sid, body) {
      return request('POST', '/api/scenarios/' + sid + '/images/prompt-preview', body || {});
    },
    generateImage: function (sid, body) {
      return request('POST', '/api/scenarios/' + sid + '/images/generate', body || {});
    },
    patchImageRatings: function (sid, imageId, body) {
      return request('PATCH', '/api/scenarios/' + sid + '/images/' + imageId + '/ratings', body || {});
    },
    generateSceneImage: function (sid, turnId) {
      var body = turnId ? { turn_id: turnId } : undefined;
      return request('POST', '/api/scenarios/' + sid + '/images/generate', body);
    },
    acceptImage: function (sid, imgId, data)   { return request('PUT',    '/api/scenarios/' + sid + '/images/' + imgId + '/accept', data || {}); },
    rateImage:   function (sid, imgId, rating) { return request('PUT',    '/api/scenarios/' + sid + '/images/' + imgId + '/rate', { rating: rating }); },
    deleteImage: function (sid, imgId)         { return request('DELETE', '/api/scenarios/' + sid + '/images/' + imgId); },

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

    /* Image generation profiles */
    getProfiles:        function ()         { return request('GET',    '/api/profiles'); },
    createProfile:      function (data)     { return request('POST',   '/api/profiles', data); },
    updateProfile:      function (id, data) { return request('PUT',    '/api/profiles/' + id, data); },
    deleteProfile:      function (id)       { return request('DELETE', '/api/profiles/' + id); },
    activateProfile:    function (id)       { return request('POST',   '/api/profiles/' + id + '/activate'); },
    clearActiveProfile: function ()         { return request('DELETE', '/api/profiles/active'); },

    /* A1111 */
    getA1111Status:     function ()     { return request('GET',  '/api/a1111/status'); },
    getA1111Models:     function ()     { return request('GET',  '/api/a1111/models'); },
    getA1111Loras:      function ()     { return request('GET',  '/api/a1111/loras'); },
    getA1111Samplers:        function ()     { return request('GET',  '/api/a1111/samplers'); },
    getA1111Schedulers:      function ()     { return request('GET',  '/api/a1111/schedulers'); },
    getA1111Upscalers:       function ()     { return request('GET',  '/api/a1111/upscalers'); },
    getA1111ControlNetModels: function ()    { return request('GET',  '/api/a1111/controlnet-models'); },
    getA1111ControlNetModules: function ()   { return request('GET',  '/api/a1111/controlnet-modules'); },
    getA1111ADetailerModels: function ()     { return request('GET',  '/api/a1111/adetailer-models'); },
    setA1111Model:           function (name) { return request('POST', '/api/a1111/model', { model_name: name }); },

    /* Audit log */
    getAuditLog: function (filters) {
      var qs = Object.keys(filters || {}).map(function (k) { return k + '=' + encodeURIComponent(filters[k]); }).join('&');
      return request('GET', '/api/audit' + (qs ? '?' + qs : ''));
    },
    getAuditRun: function (runId) { return request('GET', '/api/audit/' + runId); }
  };
})();
