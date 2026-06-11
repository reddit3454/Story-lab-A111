(function () {
  'use strict';

  var BASE_URL = 'http://localhost:4090';

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
    /* Scenarios */
    getScenarios:            function ()       { return request('GET',    '/api/scenarios'); },
    getScenario:             function (id)     { return request('GET',    '/api/scenarios/' + id); },
    createScenario:          function (data)   { return request('POST',   '/api/scenarios', data); },
    updateScenario:          function (id, d)  { return request('PUT',    '/api/scenarios/' + id, d); },
    deleteScenario:          function (id)     { return request('DELETE', '/api/scenarios/' + id); },
    resetScenarioTurns:      function (id)     { return request('DELETE', '/api/scenarios/' + id + '/turns'); },
    getScenarioCharacters:   function (id)     { return request('GET',    '/api/scenarios/' + id + '/characters'); },
    addScenarioCharacter:    function (id, cid){ return request('POST',   '/api/scenarios/' + id + '/characters', { character_id: cid }); },
    removeScenarioCharacter: function (id, cid){ return request('DELETE', '/api/scenarios/' + id + '/characters/' + cid); },
    /* image-config removed — image settings live in global_config + image_profiles */

    /* Global Image Styles */
    listStyles:                 function ()        { return request('GET',    '/api/styles'); },
    createStyle:                function (d)        { return request('POST',   '/api/styles', d); },
    updateStyle:                function (sid, d)   { return request('PUT',    '/api/styles/' + sid, d); },
    deleteStyle:                function (sid)      { return request('DELETE', '/api/styles/' + sid); },
    testFireStyle:              function (d)        { return request('POST',   '/api/styles/test-fire', d); },
    getScenarioActiveStyle:     function (id)       { return request('GET',    '/api/scenarios/' + id + '/active-style'); },
    setScenarioActiveStyle:     function (id, sid)  { return request('POST',   '/api/scenarios/' + id + '/active-style', { style_id: sid }); },
    clearScenarioActiveStyle:   function (id)       { return request('POST',   '/api/scenarios/' + id + '/active-style', { style_id: null }); },

    /* Global Locations */
    listLocations:                function ()        { return request('GET',    '/api/locations'); },
    createLocation:               function (d)        { return request('POST',   '/api/locations', d); },
    updateLocation:               function (lid, d)   { return request('PUT',    '/api/locations/' + lid, d); },
    deleteLocation:               function (lid)      { return request('DELETE', '/api/locations/' + lid); },
    getScenarioActiveLocation:    function (id)       { return request('GET',    '/api/scenarios/' + id + '/active-location'); },
    setScenarioActiveLocation:    function (id, lid)  { return request('POST',   '/api/scenarios/' + id + '/active-location', { location_id: lid }); },
    clearScenarioActiveLocation:  function (id)       { return request('POST',   '/api/scenarios/' + id + '/active-location', { location_id: null }); },

    generateSceneImage: function (id, turnId) {
      var body = turnId ? { turn_id: turnId } : undefined;
      return request('POST', '/api/scenarios/' + id + '/generate-scene-image', body);
    },

    /* Scenario character emotional states */
    getScenarioCharacterStates:    function (id)          { return request('GET', '/api/scenarios/' + id + '/character-states'); },
    updateScenarioCharacterState:  function (id, charId, d) { return request('PUT', '/api/scenarios/' + id + '/character-states/' + charId, d); },

    /* Scenario character clothing (bulk) */
    getCharacterClothing:    function (id)             { return request('GET', '/api/scenarios/' + id + '/character-clothing'); },
    updateCharacterClothing: function (id, charId, d)  { return request('PUT', '/api/scenarios/' + id + '/character-clothing/' + charId, d); },
    /* Per-character clothing override */
    getCharacterClothingById:    function (id, charId)    { return request('GET', '/api/scenarios/' + id + '/characters/' + charId + '/clothing'); },
    updateCharacterClothingById: function (id, charId, d) { return request('PUT', '/api/scenarios/' + id + '/characters/' + charId + '/clothing', d); },

    /* Turns */
    getTurns:     function (scenarioId) { return request('GET',    '/api/turns?scenario_id=' + scenarioId); },
    deleteTurn:   function (turnId)     { return request('DELETE', '/api/turns/' + turnId); },
    advanceTurn:  function (data)       { return request('POST',   '/api/turns/advance', data); },
    nudgeTurn:    function (scenarioId, opts) { return request('POST', '/api/turns/nudge', Object.assign({ scenario_id: scenarioId }, opts || {})); },
    generateTurnImage: function (data) { return request('POST', '/api/turns/generate-image', data); },
    extractScene: function (data)       { return request('POST', '/api/turns/extract-scene', data); },

    /* Characters */
    getCharacters:    function ()       { return request('GET',    '/api/characters'); },
    getCharacter:     function (id)     { return request('GET',    '/api/characters/' + id); },
    createCharacter:  function (data)   { return request('POST',   '/api/characters', data); },
    updateCharacter:  function (id, d)  { return request('PUT',    '/api/characters/' + id, d); },
    deleteCharacter:  function (id)     { return request('DELETE', '/api/characters/' + id); },
    generateReference:  function (cid, d)    { return request('POST',   '/api/characters/' + cid + '/generate-reference', d || {}); },
    generateFullbody:   function (cid, d)    { return request('POST',   '/api/characters/' + cid + '/generate-fullbody', d || {}); },
    getFullbodies:      function (cid)       { return request('GET',    '/api/characters/' + cid + '/fullbodies'); },
    deleteFullbodyById: function (cid, fbId) { return request('DELETE', '/api/characters/' + cid + '/fullbodies/' + fbId); },
    deleteFullbody:     function (cid)       { return request('DELETE', '/api/characters/' + cid + '/fullbody'); },
    useFullbodyAsRef:   function (cid, fn)   { return request('POST',   '/api/characters/' + cid + '/fullbody/use-as-reference', fn ? { filename: fn } : {}); },
    getReferences:      function (cid)       { return request('GET',    '/api/characters/' + cid + '/references'); },
    acceptReference:    function (cid, rid)  { return request('POST',   '/api/characters/' + cid + '/references/' + rid + '/accept'); },
    setReferenceImage:   function (cid, fn)  { return request('PUT',    '/api/characters/' + cid + '/reference-image', { filename: fn }); },
    clearReferenceImage: function (cid)     { return request('DELETE', '/api/characters/' + cid + '/reference-image'); },
    deleteReference:    function (cid, rid)  { return request('DELETE', '/api/characters/' + cid + '/references/' + rid); },
    /* Character bonds */
    getCharacterBonds:    function (cid)          { return request('GET',    '/api/characters/' + cid + '/bonds'); },
    createCharacterBond:  function (cid, data)    { return request('POST',   '/api/characters/' + cid + '/bonds', data); },
    updateCharacterBond:  function (cid, bid, d)  { return request('PUT',    '/api/characters/' + cid + '/bonds/' + bid, d); },
    deleteCharacterBond:  function (cid, bid)     { return request('DELETE', '/api/characters/' + cid + '/bonds/' + bid); },
    uploadReference:    function (cid, file) {
      var fd = new FormData();
      fd.append('referenceImage', file);
      return fetch(BASE_URL + '/api/characters/' + cid + '/upload-reference', {
        method: 'POST', body: fd
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || r.statusText); });
        return r.json();
      });
    },
    getRelationships:   function (scenarioId)           { return request('GET',    '/api/scenarios/' + scenarioId + '/relationships'); },
    createRelationship: function (scenarioId, data)     { return request('POST',   '/api/scenarios/' + scenarioId + '/relationships', data); },
    updateRelationship: function (scenarioId, relId, d) { return request('PUT',    '/api/scenarios/' + scenarioId + '/relationships/' + relId, d); },
    deleteRelationship: function (scenarioId, relId)    { return request('DELETE', '/api/scenarios/' + scenarioId + '/relationships/' + relId); },

    /* World entries */
    getWorldEntries:   function (scenarioId) { return request('GET',    '/api/world-entries?scenarioId=' + scenarioId); },
    createWorldEntry:  function (data)       { return request('POST',   '/api/world-entries', data); },
    updateWorldEntry:  function (id, d)      { return request('PUT',    '/api/world-entries/' + id, d); },
    deleteWorldEntry:  function (id)         { return request('DELETE', '/api/world-entries/' + id); },

    /* Rules */
    getGlobalRules:    function ()           { return request('GET', '/api/rules?scope=global'); },
    getScenarioRules:  function (scenarioId) { return request('GET', '/api/rules?scope=scenario&scopeId=' + scenarioId); },
    createRule:        function (data)       { return request('POST',   '/api/rules', data); },
    updateRule:        function (id, d)      { return request('PUT',    '/api/rules/' + id, d); },
    deleteRule:        function (id)         { return request('DELETE', '/api/rules/' + id); },

    /* Images */
    generateImage: function (data)         { return request('POST', '/api/images/generate', data); },
    acceptImage:   function (id, data)     { return request('PUT',  '/api/images/' + id + '/accept', data); },
    rateImage:     function (id, rating)   { return request('PUT',  '/api/images/' + id + '/rate', { rating: rating }); },
    getImages:     function (turnId)       { return request('GET',  '/api/images?turn_id=' + turnId); },
    deleteImage:   function (id)           { return request('DELETE', '/api/images/' + id); },
    /* animateImage removed — Wan2.2 not in this project */

    /* Memories */
    getMemories:         function (scenarioId)           { return request('GET',    '/api/scenarios/' + scenarioId + '/memories'); },
    createManualMemory:  function (scenarioId, content)  { return request('POST',   '/api/scenarios/' + scenarioId + '/memories/manual', { content: content }); },
    deleteMemory:        function (scenarioId, memoryId) { return request('DELETE', '/api/scenarios/' + scenarioId + '/memories/' + memoryId); },

    /* Turns (regenerate) */
    regenerateTurn:         function (scenarioId, turnId, instruction)   { return request('POST',  '/api/scenarios/' + scenarioId + '/turns/' + turnId + '/regenerate',                { instruction: instruction || '' }); },
    regenerateTurnImage:    function (scenarioId, turnId, prompt)        { return request('POST',  '/api/scenarios/' + scenarioId + '/turns/' + turnId + '/regenerate-image',           { prompt: prompt }); },
    updateTurn:             function (scenarioId, turnId, content)       { return request('PATCH', '/api/scenarios/' + scenarioId + '/turns/' + turnId,                                 { content: content }); },

    resetModels:          function (scenarioId) { return request('POST', '/api/llm/reset', { scenarioId: scenarioId }); },

    /* Misc */
    getHealth:        function () { return request('GET', '/api/health'); },
    getOllamaModels:  function () { return request('GET', '/api/ollama/models'); },
    getHealthA1111:   function () { return request('GET', '/api/health/a1111'); },
    getHealthOllama:  function () { return request('GET', '/api/health/ollama'); },
    getHealthLibrary: function () { return request('GET', '/api/health/library'); },
    getLoRAs:         function () { return request('GET', '/api/a1111/loras'); },

    /* llama.cpp config */
    getLlamacppConfig:  function ()     { return request('GET', '/api/settings/llamacpp'); },
    saveLlamacppConfig: function (data) { return request('PUT', '/api/settings/llamacpp', data); },

    /* Global config (A1111 master settings) */
    getConfig:  function ()         { return request('GET', '/api/config'); },
    setConfig:  function (key, val) { return request('PUT', '/api/config', { key: key, value: val }); },
    setConfigs: function (map)      { return request('PUT', '/api/config/bulk', map); },

    /* A1111 direct */
    getA1111Status: function ()      { return request('GET',  '/api/a1111/status'); },
    getA1111Models: function ()      { return request('GET',  '/api/a1111/models'); },
    getA1111Loras:  function ()      { return request('GET',  '/api/a1111/loras'); },
    setA1111Model:  function (name)  { return request('POST', '/api/a1111/model', { model: name }); },

    /* Image generation profiles */
    getProfiles:       function ()         { return request('GET',    '/api/profiles'); },
    createProfile:     function (data)     { return request('POST',   '/api/profiles', data); },
    updateProfile:     function (id, data) { return request('PUT',    '/api/profiles/' + id, data); },
    deleteProfile:     function (id)       { return request('DELETE', '/api/profiles/' + id); },
    activateProfile:   function (id)       { return request('POST',   '/api/profiles/' + id + '/activate'); },
    clearActiveProfile: function ()        { return request('DELETE', '/api/profiles/active'); },

    /* Audit log */
    getAuditLog: function (filters) {
      var qs = Object.keys(filters || {}).map(function (k) { return k + '=' + encodeURIComponent(filters[k]); }).join('&');
      return request('GET', '/api/audit' + (qs ? '?' + qs : ''));
    },
    getAuditRun: function (runId) { return request('GET', '/api/audit/' + runId); },

    /* Scenario last image prompt (for audit/debug) */
    getScenarioLastImagePrompt: function (id) { return request('GET', '/api/scenarios/' + id + '/last-image-prompt'); },

    /* Character Gallery */
    getCharacterGallery:         function (charId)              { return request('GET',    '/api/characters/' + charId + '/gallery'); },
    deleteCharacterGalleryImage: function (charId, imgId)       { return request('DELETE', '/api/characters/' + charId + '/gallery/' + imgId); },
    assignGalleryImage:          function (charId, imgId, data) { return request('POST',   '/api/characters/' + charId + '/gallery/' + imgId + '/assign', data); },
    unassignGalleryImage:        function (charId, imgId, data) { return request('POST',   '/api/characters/' + charId + '/gallery/' + imgId + '/unassign', data); },
    uploadCharacterGalleryImage: function (charId, file) {
      return fetch(BASE_URL + '/api/characters/' + charId + '/gallery', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'image/png' },
        body: file
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (e) { throw new Error(e.error || r.statusText); });
        return r.json();
      });
    }
  };
})();
