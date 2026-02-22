/**
 * RL Minesweeper – in-browser inference.
 * Encodes board state to (1, 3, H, W) and runs ONNX policy; returns action { type: 'reveal', x, y }.
 * Observation convention (must match Python): channel 0 revealed, 1 flagged, 2 adj/9 (unrevealed = 1.0).
 */
(function (global) {
  'use strict';

  var session = null;
  var modelW = 9;
  var modelH = 9;
  var nActions = 81;

  /**
   * Encode grid state to Float32 (1, 3, H, W). Same convention as rl-minesweeper/env.py.
   * state: { w, h, grid } where grid[i] = { revealed, flagged, adj }.
   */
  function encodeState(state) {
    var w = state.w;
    var h = state.h;
    var grid = state.grid;
    var size = w * h;
    var buf = new Float32Array(3 * h * w);
    var idx = 0;
    for (var c = 0; c < 3; c++) {
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var i = y * w + x;
          var cell = grid[i];
          if (c === 0) {
            buf[idx++] = cell.revealed ? 1.0 : 0.0;
          } else if (c === 1) {
            buf[idx++] = cell.flagged ? 1.0 : 0.0;
          } else {
            buf[idx++] = cell.revealed ? cell.adj / 9.0 : 1.0;
          }
        }
      }
    }
    return buf;
  }

  /**
   * Load ONNX model from url (e.g. base_path + '/assets/rl-minesweeper/policy.onnx').
   * Returns a Promise that resolves when loaded; session is stored for getRLAction.
   */
  function loadRLModel(url) {
    var ort = global.ort || global.Ort;
    if (ort === undefined) {
      return Promise.reject(new Error('ONNX Runtime Web not loaded. Include onnxruntime-web script first.'));
    }
    return ort.InferenceSession.create(url, {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'all'
    }).then(function (s) {
      session = s;
      modelW = 9;
      modelH = 9;
      nActions = modelW * modelH;
      return session;
    });
  }

  /**
   * Get one RL action for the given state. state: { w, h, grid }.
   * Returns Promise<{ type: 'reveal', x, y } | null>. null if no valid action or model not loaded.
   */
  function getRLAction(state) {
    if (session == null) {
      return Promise.resolve(null);
    }
    var w = state.w;
    var h = state.h;
    if (w !== modelW || h !== modelH) {
      return Promise.resolve(null);
    }
    var grid = state.grid;
    var validIndices = [];
    for (var i = 0; i < w * h; i++) {
      if (!grid[i].revealed && !grid[i].flagged) validIndices.push(i);
    }
    if (validIndices.length === 0) {
      return Promise.resolve(null);
    }
    var buf = encodeState(state);
    var ort = global.ort || global.Ort;
    var feeds = {};
    var tensor;
    if (ort.Tensor !== undefined) {
      try {
        tensor = new ort.Tensor('float32', buf, [1, 3, h, w]);
      } catch (e) {
        tensor = new ort.Tensor(buf, [1, 3, h, w]);
      }
    } else {
      tensor = { data: buf, dims: [1, 3, h, w], type: 'float32' };
    }
    feeds[session.inputNames[0]] = tensor;
    return session.run(feeds).then(function (results) {
      var logits = results[session.outputNames[0]];
      var data = logits.data;
      var bestAction = -1;
      var bestVal = -Infinity;
      for (var k = 0; k < validIndices.length; k++) {
        var idx = validIndices[k];
        var v = data[idx];
        if (v > bestVal) {
          bestVal = v;
          bestAction = idx;
        }
      }
      if (bestAction < 0) return null;
      var x = bestAction % w;
      var y = Math.floor(bestAction / w);
      return { type: 'reveal', x: x, y: y };
    });
  }

  /**
   * Check if the RL model is loaded and board size matches.
   */
  function isRLReady(w, h) {
    return session != null && w === modelW && h === modelH;
  }

  global.RLMinesweeper = {
    loadRLModel: loadRLModel,
    getRLAction: getRLAction,
    isRLReady: isRLReady,
    encodeState: encodeState
  };
})(typeof window !== 'undefined' ? window : this);
