/**
 * RLMS Minesweeper – merged implementation:
 * - Minesweeper implementation by David Parkinson (game dynamics, visuals, first-click safe, chording, keyboard, timer).
 * - Autosolver logic by David Hill, JSMinesweeper (trivial analysis, probability engine, 50/50, guessing).
 */
(function () {
  'use strict';

  var boardEl = document.getElementById('minesweeper-board');
  if (!boardEl) return;

  var minesLeftEl = document.getElementById('minesweeper-mines-left');
  var timeEl = document.getElementById('minesweeper-time');
  var statusEl = document.getElementById('minesweeper-status');
  var faceEl = document.getElementById('minesweeper-face');
  var metaSizeEl = document.getElementById('minesweeper-meta-size');
  var metaMinesEl = document.getElementById('minesweeper-meta-mines');
  var presetEl = document.getElementById('minesweeper-preset');
  var wEl = document.getElementById('minesweeper-w');
  var hEl = document.getElementById('minesweeper-h');
  var mEl = document.getElementById('minesweeper-m');
  var newBtn = document.getElementById('minesweeper-new-game');
  var autosolveBtn = document.getElementById('minesweeper-autosolve');
  var autoplayBtn = document.getElementById('minesweeper-autoplay');
  var resetBtn = document.getElementById('minesweeper-reset');

  var autoplayActive = false;
  var autoplayPauseMs = 1200;
  var AUTOPLAY_START_DELAY_MS = 150;
  var autoplayWins = 0;
  var autoplayGames = 0;
  var autoplayResults = [];

  var W = 9, H = 9, MINES = 10;
  var firstClick = true;
  var gameOver = false;
  var revealedCount = 0;
  var flagCount = 0;
  var boomCell = null;
  var grid = [];
  var timer = 0;
  var timerId = null;
  var hovered = null;
  var isAutosolving = false;

  var dirs = [];
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx || dy) dirs.push([dx, dy]);
    }
  }

  function key(x, y) { return x + ',' + y; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function inBounds(x, y) { return x >= 0 && x < W && y >= 0 && y < H; }
  function idxOf(x, y) { return y * W + x; }

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function startTimer() {
    if (timerId) return;
    timerId = setInterval(function () {
      timer++;
      if (timeEl) timeEl.textContent = String(timer);
    }, 1000);
  }

  function resetTimer() {
    stopTimer();
    timer = 0;
    if (timeEl) timeEl.textContent = '0';
  }

  function applyPreset() {
    var p = presetEl ? presetEl.value : 'beginner';
    if (p === 'beginner') { W = 9; H = 9; MINES = 10; }
    else if (p === 'intermediate') { W = 16; H = 16; MINES = 40; }
    else if (p === 'expert') { W = 30; H = 16; MINES = 99; }
    else {
      W = parseInt(wEl.value, 10) || 9;
      H = parseInt(hEl.value, 10) || 9;
      MINES = parseInt(mEl.value, 10) || 10;
    }
    syncInputs();
  }

  function syncInputs() {
    if (wEl) wEl.value = W;
    if (hEl) hEl.value = H;
    if (mEl) mEl.value = MINES;
    if (metaSizeEl) metaSizeEl.textContent = W + '×' + H;
    if (metaMinesEl) metaMinesEl.textContent = String(MINES);
  }

  function validateAndClamp() {
    W = clamp(parseInt(wEl.value, 10) || 9, 5, 50);
    H = clamp(parseInt(hEl.value, 10) || 9, 5, 50);
    var maxM = W * H - 1;
    MINES = clamp(parseInt(mEl.value, 10) || 10, 1, maxM);
    if (wEl) wEl.value = W;
    if (hEl) hEl.value = H;
    if (mEl) mEl.value = MINES;
    if (metaSizeEl) metaSizeEl.textContent = W + '×' + H;
    if (metaMinesEl) metaMinesEl.textContent = String(MINES);
  }

  function setStatus(html, kind) {
    if (!statusEl) return;
    statusEl.className = 'rlms-status' + (kind ? ' rlms-status--' + kind : '');
    statusEl.innerHTML = html;
  }

  function setFace(emoji) {
    if (faceEl) faceEl.textContent = emoji;
  }

  function updateCellView(x, y) {
    var c = grid[idxOf(x, y)];
    var el = c.el;
    if (!el) return;

    el.classList.toggle('rlms-cell--revealed', c.revealed);
    el.classList.toggle('rlms-cell--flagged', c.flagged);

    if (!c.revealed) {
      el.textContent = c.flagged ? '🚩' : '';
      el.classList.remove('rlms-cell--mine', 'rlms-cell--boom');
      for (var i = 1; i <= 8; i++) el.classList.remove('rlms-cell--n' + i);
      return;
    }

    if (c.mine) {
      el.textContent = '💣';
      el.classList.add('rlms-cell--mine');
      if (boomCell && boomCell.x === x && boomCell.y === y) el.classList.add('rlms-cell--boom');
      return;
    }

    if (c.adj === 0) {
      el.textContent = '';
    } else {
      el.textContent = String(c.adj);
      el.classList.add('rlms-cell--n' + c.adj);
    }
  }

  function updateMinesLeft() {
    var left = Math.max(0, MINES - flagCount);
    if (minesLeftEl) minesLeftEl.textContent = String(left);
  }

  function placeMinesSafe(safeX, safeY) {
    var protectedSet = {};
    protectedSet[key(safeX, safeY)] = true;
    for (var i = 0; i < dirs.length; i++) {
      var nx = safeX + dirs[i][0], ny = safeY + dirs[i][1];
      if (inBounds(nx, ny)) protectedSet[key(nx, ny)] = true;
    }

    var candidates = [];
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        if (!protectedSet[key(x, y)]) candidates.push([x, y]);
      }
    }

    if (candidates.length < MINES) {
      candidates = [];
      for (var y = 0; y < H; y++) {
        for (var x = 0; x < W; x++) {
          if (!(x === safeX && y === safeY)) candidates.push([x, y]);
        }
      }
    }

    for (var i = candidates.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var t = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = t;
    }

    for (var i = 0; i < MINES; i++) {
      var xy = candidates[i];
      grid[idxOf(xy[0], xy[1])].mine = true;
    }

    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var cell = grid[idxOf(x, y)];
        if (cell.mine) { cell.adj = 0; continue; }
        var n = 0;
        for (var d = 0; d < dirs.length; d++) {
          var nx = x + dirs[d][0], ny = y + dirs[d][1];
          if (inBounds(nx, ny) && grid[idxOf(nx, ny)].mine) n++;
        }
        cell.adj = n;
      }
    }
  }

  function toggleFlag(x, y) {
    var c = grid[idxOf(x, y)];
    if (c.revealed) return;
    c.flagged = !c.flagged;
    flagCount += c.flagged ? 1 : -1;
    updateCellView(x, y);
    updateMinesLeft();
    checkWin();
  }

  function reveal(x, y) {
    if (!inBounds(x, y)) return;
    var c0 = grid[idxOf(x, y)];
    if (c0.revealed || c0.flagged) return;

    if (firstClick) {
      firstClick = false;
      placeMinesSafe(x, y);
      startTimer();
    }

    if (c0.mine) {
      c0.revealed = true;
      boomCell = { x: x, y: y };
      updateCellView(x, y);
      endGame(false);
      return;
    }

    var q = [[x, y]];
    var seen = {};
    seen[key(x, y)] = true;

    while (q.length) {
      var cx = q[0][0], cy = q[0][1];
      q.shift();
      var cell = grid[idxOf(cx, cy)];
      if (cell.revealed || cell.flagged) continue;
      cell.revealed = true;
      revealedCount++;
      updateCellView(cx, cy);

      if (cell.adj === 0) {
        for (var d = 0; d < dirs.length; d++) {
          var nx = cx + dirs[d][0], ny = cy + dirs[d][1];
          if (!inBounds(nx, ny)) continue;
          var nk = key(nx, ny);
          if (seen[nk]) continue;
          var nc = grid[idxOf(nx, ny)];
          if (!nc.revealed && !nc.flagged) {
            seen[nk] = true;
            q.push([nx, ny]);
          }
        }
      }
    }

    checkWin();
  }

  function chord(x, y) {
    var c = grid[idxOf(x, y)];
    if (!c.revealed || c.adj === 0) return;

    var flags = 0;
    var neighbors = [];
    for (var d = 0; d < dirs.length; d++) {
      var nx = x + dirs[d][0], ny = y + dirs[d][1];
      if (!inBounds(nx, ny)) continue;
      var nc = grid[idxOf(nx, ny)];
      neighbors.push([nx, ny, nc]);
      if (nc.flagged) flags++;
    }
    if (flags !== c.adj) return;

    for (var i = 0; i < neighbors.length; i++) {
      var n = neighbors[i];
      if (!n[2].flagged && !n[2].revealed) reveal(n[0], n[1]);
    }
  }

  function revealAllMines() {
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var c = grid[idxOf(x, y)];
        if (c.mine) {
          c.revealed = true;
          updateCellView(x, y);
        } else if (gameOver && c.flagged && !c.mine) {
          c.el.textContent = '❌';
          c.el.classList.add('rlms-cell--revealed');
        }
      }
    }
  }

  function endGame(win) {
    gameOver = true;
    stopTimer();
    if (win) {
      setFace('😎');
      setStatus('<b>Status:</b> You win! 🎉 Cleared in <b>' + timer + '</b>s.', 'win');
    } else {
      setFace('💀');
      revealAllMines();
      setStatus('<b>Status:</b> Boom. 💥 Click <span class="rlms-kbd">New Game</span> to try again.', 'lose');
    }
  }

  function checkWin() {
    if (gameOver || firstClick) return;
    var safeCells = W * H - MINES;
    if (revealedCount >= safeCells) {
      for (var y = 0; y < H; y++) {
        for (var x = 0; x < W; x++) {
          var c = grid[idxOf(x, y)];
          if (!c.revealed && c.mine && !c.flagged) {
            c.flagged = true;
            flagCount++;
            updateCellView(x, y);
          }
        }
      }
      updateMinesLeft();
      endGame(true);
    }
  }

  // ---------- David Hill–style autosolver ----------
  function countAdjacentFlags(x, y) {
    var n = 0;
    for (var d = 0; d < dirs.length; d++) {
      var nx = x + dirs[d][0], ny = y + dirs[d][1];
      if (inBounds(nx, ny) && grid[idxOf(nx, ny)].flagged) n++;
    }
    return n;
  }

  function getAdjacentHidden(x, y) {
    var out = [];
    for (var d = 0; d < dirs.length; d++) {
      var nx = x + dirs[d][0], ny = y + dirs[d][1];
      if (!inBounds(nx, ny)) continue;
      var c = grid[idxOf(nx, ny)];
      if (!c.revealed && !c.flagged) out.push([nx, ny]);
    }
    return out;
  }

  function trivialAnalysis() {
    var toReveal = {};
    var toFlag = {};
    var x, y, cell, num, adjFlags, hidden, need, i, k;

    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        cell = grid[idxOf(x, y)];
        if (!cell.revealed || cell.mine) continue;
        num = Number(cell.adj);
        if (num < 0 || num > 8) continue;
        adjFlags = countAdjacentFlags(x, y);
        hidden = getAdjacentHidden(x, y);
        if (hidden.length === 0) continue;

        need = num - adjFlags;
        if (need < 0) continue;

        if (adjFlags === num) {
          for (i = 0; i < hidden.length; i++) {
            k = key(hidden[i][0], hidden[i][1]);
            toReveal[k] = hidden[i];
          }
        } else if (need === hidden.length) {
          for (i = 0; i < hidden.length; i++) {
            k = key(hidden[i][0], hidden[i][1]);
            toFlag[k] = hidden[i];
          }
        }
      }
    }

    var revealList = Object.keys(toReveal).map(function (k) { return toReveal[k]; });
    var flagList = Object.keys(toFlag).map(function (k) { return toFlag[k]; });

    if (revealList.length === 0 && flagList.length === 0) return null;
    return { toReveal: revealList, toFlag: flagList };
  }

  var MAX_FRONTIER_FOR_PROB = 28;
  var PROBABILITY_ENGINE_TIMEOUT_MS = 8000;
  var BRUTE_FORCE_MAX_SOLUTIONS = 750;

  function getFrontier() {
    var set = {};
    var x, y, d, nx, ny, cell;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        cell = grid[idxOf(x, y)];
        if (!cell.revealed) continue;
        for (d = 0; d < dirs.length; d++) {
          nx = x + dirs[d][0];
          ny = y + dirs[d][1];
          if (!inBounds(nx, ny)) continue;
          var nc = grid[idxOf(nx, ny)];
          if (!nc.revealed && !nc.flagged) set[key(nx, ny)] = [nx, ny];
        }
      }
    }
    var list = Object.keys(set).map(function (id) { return set[id]; });
    return list;
  }

  function getConstraints(frontierSet) {
    var constraints = [];
    var x, y, cell, need, hidden, indices, i, id;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        cell = grid[idxOf(x, y)];
        if (!cell.revealed || cell.mine || cell.adj == null) continue;
        need = cell.adj - countAdjacentFlags(x, y);
        hidden = getAdjacentHidden(x, y);
        if (hidden.length === 0) continue;
        if (need < 0 || need > hidden.length) continue;
        indices = [];
        for (i = 0; i < hidden.length; i++) {
          id = key(hidden[i][0], hidden[i][1]);
          if (frontierSet[id] !== undefined) indices.push(frontierSet[id]);
        }
        if (indices.length > 0) constraints.push({ indices: indices, need: need });
      }
    }
    return constraints;
  }

  function getConstraintComponents(F, constraints) {
    var parent = [];
    var i, c, j, a, b;
    for (i = 0; i < F; i++) parent[i] = i;
    function find(x) {
      if (parent[x] !== x) parent[x] = find(parent[x]);
      return parent[x];
    }
    function union(a, b) {
      a = find(a);
      b = find(b);
      if (a !== b) parent[a] = b;
    }
    for (c = 0; c < constraints.length; c++) {
      var inds = constraints[c].indices;
      for (j = 1; j < inds.length; j++) union(inds[0], inds[j]);
    }
    var compIds = {};
    var compList = [];
    for (i = 0; i < F; i++) {
      var root = find(i);
      if (compIds[root] === undefined) {
        compIds[root] = compList.length;
        compList.push([]);
      }
      compList[compIds[root]].push(i);
    }
    return compList;
  }

  function probabilityEngineSingleComponent(frontier, constraints, targetK, startTime) {
    var F = frontier.length;
    var mineCounts = [];
    var i, c, j;
    for (i = 0; i < F; i++) mineCounts[i] = 0;
    var totalSolutions = 0;
    var assignment = [];
    var constraintsByIdx = [];
    for (i = 0; i < F; i++) constraintsByIdx[i] = [];
    for (c = 0; c < constraints.length; c++) {
      for (j = 0; j < constraints[c].indices.length; j++) {
        constraintsByIdx[constraints[c].indices[j]].push(c);
      }
    }
    function remainingInConstraint(ci, fromIdx) {
      var r = 0;
      for (j = 0; j < constraints[ci].indices.length; j++) {
        if (constraints[ci].indices[j] >= fromIdx) r++;
      }
      return r;
    }
    function checkConstraints() {
      var sum;
      for (c = 0; c < constraints.length; c++) {
        sum = 0;
        for (j = 0; j < constraints[c].indices.length; j++) sum += assignment[constraints[c].indices[j]];
        if (sum !== constraints[c].need) return false;
      }
      return true;
    }
    var partialSum = [];
    for (c = 0; c < constraints.length; c++) partialSum[c] = 0;
    function recurse(idx, placed) {
      if (startTime && Date.now() - startTime > PROBABILITY_ENGINE_TIMEOUT_MS) return;
      if (idx === F) {
        if (placed !== targetK || !checkConstraints()) return;
        totalSolutions++;
        for (i = 0; i < F; i++) mineCounts[i] += assignment[i];
        return;
      }
      var canZero = true, canOne = true;
      for (j = 0; j < constraintsByIdx[idx].length; j++) {
        c = constraintsByIdx[idx][j];
        var need = constraints[c].need, r = remainingInConstraint(c, idx);
        if (need - r + 1 > partialSum[c] || partialSum[c] > need) canZero = false;
        if (need - r > partialSum[c] || partialSum[c] > need - 1) canOne = false;
      }
      if (canZero) {
        assignment[idx] = 0;
        for (j = 0; j < constraintsByIdx[idx].length; j++) partialSum[constraintsByIdx[idx][j]] += 0;
        recurse(idx + 1, placed);
        for (j = 0; j < constraintsByIdx[idx].length; j++) partialSum[constraintsByIdx[idx][j]] -= 0;
      }
      if (canOne) {
        assignment[idx] = 1;
        for (j = 0; j < constraintsByIdx[idx].length; j++) partialSum[constraintsByIdx[idx][j]] += 1;
        recurse(idx + 1, placed + 1);
        for (j = 0; j < constraintsByIdx[idx].length; j++) partialSum[constraintsByIdx[idx][j]] -= 1;
      }
    }
    recurse(0, 0);
    return { solutions: totalSolutions, mineCounts: mineCounts };
  }

  function probabilityEngine(frontier, constraints, remainingMines, otherHiddenCount) {
    var F = frontier.length;
    var O = otherHiddenCount;
    var M = remainingMines;
    var minK = Math.max(0, M - O);
    var maxK = Math.min(F, M);
    var startTime = Date.now();

    var components = getConstraintComponents(F, constraints);
    if (components.length > 1) {
      var compResults = [];
      var cc, comp, oldToNew, subFrontier, subConstraints, k, res, solutionsByK, mineCountsByK, c, j, i, K, k1;
      for (cc = 0; cc < components.length; cc++) {
        comp = components[cc];
        oldToNew = {};
        subFrontier = [];
        for (var ci = 0; ci < comp.length; ci++) {
          oldToNew[comp[ci]] = ci;
          subFrontier.push(frontier[comp[ci]]);
        }
        subConstraints = [];
        for (c = 0; c < constraints.length; c++) {
          var allIn = true;
          for (j = 0; j < constraints[c].indices.length; j++) {
            if (oldToNew[constraints[c].indices[j]] === undefined) { allIn = false; break; }
          }
          if (allIn && constraints[c].indices.length > 0) {
            var remap = [];
            for (j = 0; j < constraints[c].indices.length; j++) remap.push(oldToNew[constraints[c].indices[j]]);
            subConstraints.push({ indices: remap, need: constraints[c].need });
          }
        }
        solutionsByK = [];
        mineCountsByK = [];
        for (k = 0; k <= comp.length; k++) {
          res = probabilityEngineSingleComponent(subFrontier, subConstraints, k, startTime);
          solutionsByK[k] = res.solutions;
          mineCountsByK[k] = res.mineCounts;
        }
        compResults.push({ comp: comp, solutionsByK: solutionsByK, mineCountsByK: mineCountsByK, size: comp.length });
      }
      var totalSolutions = 0;
      var mineCounts = [];
      for (i = 0; i < F; i++) mineCounts[i] = 0;
      function convolveTwo(r1, r2) {
        var F1 = r1.size, F2 = r2.size;
        var S1 = r1.solutionsByK, S2 = r2.solutionsByK;
        var MC1 = r1.mineCountsByK, MC2 = r2.mineCountsByK;
        var total = 0;
        var newMC1 = [], newMC2 = [];
        for (i = 0; i < F1; i++) newMC1[i] = 0;
        for (i = 0; i < F2; i++) newMC2[i] = 0;
        for (var K = minK; K <= maxK; K++) {
          for (var k1 = Math.max(0, K - F2); k1 <= Math.min(F1, K); k1++) {
            var k2 = K - k1;
            var prod = S1[k1] * S2[k2];
            total += prod;
            for (i = 0; i < F1; i++) newMC1[i] += MC1[k1][i] * S2[k2];
            for (i = 0; i < F2; i++) newMC2[i] += MC2[k2][i] * S1[k1];
          }
        }
        return { total: total, mc1: newMC1, mc2: newMC2 };
      }
      var combined = compResults[0];
      for (var rr = 1; rr < compResults.length; rr++) {
        var left = combined;
        var right = compResults[rr];
        var leftSize = left.size;
        var rightSize = right.size;
        var newSByK = [];
        var newMCByK = [];
        for (K = 0; K <= leftSize + rightSize; K++) {
          newSByK[K] = 0;
          newMCByK[K] = [];
          for (i = 0; i < leftSize + rightSize; i++) newMCByK[K][i] = 0;
          for (k1 = Math.max(0, K - rightSize); k1 <= Math.min(leftSize, K); k1++) {
            var k2 = K - k1;
            newSByK[K] += left.solutionsByK[k1] * right.solutionsByK[k2];
            for (i = 0; i < leftSize; i++) newMCByK[K][i] += left.mineCountsByK[k1][i] * right.solutionsByK[k2];
            for (i = 0; i < rightSize; i++) newMCByK[K][leftSize + i] += right.mineCountsByK[k2][i] * left.solutionsByK[k1];
          }
        }
        combined = {
          comp: left.comp.concat(right.comp),
          solutionsByK: newSByK,
          mineCountsByK: newMCByK,
          size: leftSize + rightSize
        };
      }
      totalSolutions = 0;
      for (i = 0; i < F; i++) mineCounts[i] = 0;
      for (K = minK; K <= maxK; K++) {
        totalSolutions += combined.solutionsByK[K] || 0;
        if (combined.mineCountsByK[K]) {
          for (i = 0; i < F; i++) mineCounts[combined.comp[i]] += combined.mineCountsByK[K][i] || 0;
        }
      }
      var probs = {};
      for (i = 0; i < F; i++) {
        probs[key(frontier[i][0], frontier[i][1])] = totalSolutions === 0 ? 0.5 : mineCounts[i] / totalSolutions;
      }
      return { probs: probs, totalSolutions: totalSolutions, mineCounts: mineCounts };
    }

    var mineCounts = [];
    for (i = 0; i < F; i++) mineCounts[i] = 0;
    var totalSolutions = 0;
    var assignment = [];
    var i, c, j;

    var constraintsByIdx = [];
    for (i = 0; i < F; i++) constraintsByIdx[i] = [];
    for (c = 0; c < constraints.length; c++) {
      for (j = 0; j < constraints[c].indices.length; j++) {
        var idx = constraints[c].indices[j];
        constraintsByIdx[idx].push(c);
      }
    }
    function remainingInConstraint(constraintIdx, fromIdx) {
      var r = 0;
      for (j = 0; j < constraints[constraintIdx].indices.length; j++) {
        if (constraints[constraintIdx].indices[j] >= fromIdx) r++;
      }
      return r;
    }

    function checkConstraints() {
      var sum;
      for (c = 0; c < constraints.length; c++) {
        sum = 0;
        for (j = 0; j < constraints[c].indices.length; j++) sum += assignment[constraints[c].indices[j]];
        if (sum !== constraints[c].need) return false;
      }
      return true;
    }

    var partialSum = [];
    for (c = 0; c < constraints.length; c++) partialSum[c] = 0;

    function recurse(idx, placed) {
      if (Date.now() - startTime > PROBABILITY_ENGINE_TIMEOUT_MS) return;
      if (idx === F) {
        if (placed < minK || placed > maxK) return;
        if (!checkConstraints()) return;
        totalSolutions++;
        for (i = 0; i < F; i++) mineCounts[i] += assignment[i];
        return;
      }
      var canZero = true;
      var canOne = true;
      for (j = 0; j < constraintsByIdx[idx].length; j++) {
        c = constraintsByIdx[idx][j];
        var need = constraints[c].need;
        var r = remainingInConstraint(c, idx);
        if (need - r + 1 > partialSum[c] || partialSum[c] > need) canZero = false;
        if (need - r > partialSum[c] || partialSum[c] > need - 1) canOne = false;
      }
      var remainingCells = F - idx - 1;
      if (placed > maxK || placed + remainingCells < minK) canZero = false;
      if (placed + 1 > maxK || placed + 1 + remainingCells < minK) canOne = false;

      if (canZero) {
        assignment[idx] = 0;
        for (j = 0; j < constraintsByIdx[idx].length; j++) {
          c = constraintsByIdx[idx][j];
          partialSum[c] += 0;
        }
        recurse(idx + 1, placed);
        for (j = 0; j < constraintsByIdx[idx].length; j++) {
          c = constraintsByIdx[idx][j];
          partialSum[c] -= 0;
        }
      }
      if (canOne) {
        assignment[idx] = 1;
        for (j = 0; j < constraintsByIdx[idx].length; j++) {
          c = constraintsByIdx[idx][j];
          partialSum[c] += 1;
        }
        recurse(idx + 1, placed + 1);
        for (j = 0; j < constraintsByIdx[idx].length; j++) {
          c = constraintsByIdx[idx][j];
          partialSum[c] -= 1;
        }
      }
    }

    recurse(0, 0);

    var probs = {};
    for (i = 0; i < F; i++) {
      var k = key(frontier[i][0], frontier[i][1]);
      probs[k] = totalSolutions === 0 ? 0.5 : mineCounts[i] / totalSolutions;
    }
    return { probs: probs, totalSolutions: totalSolutions, mineCounts: mineCounts };
  }

  function find5050(frontier, constraints, frontierSet) {
    var pairs = [];
    var quads = [];
    var c, inds, need, i, j, k, keys4, sumNeed, cx, cy, constraintTouchesOnly;
    for (c = 0; c < constraints.length; c++) {
      inds = constraints[c].indices;
      need = constraints[c].need;
      if (inds.length === 2 && need === 1) {
        pairs.push([frontier[inds[0]], frontier[inds[1]]]);
      }
    }
    for (cy = 0; cy < H - 1; cy++) {
      for (cx = 0; cx < W - 1; cx++) {
        keys4 = [
          key(cx, cy), key(cx + 1, cy), key(cx, cy + 1), key(cx + 1, cy + 1)
        ];
        if (frontierSet[keys4[0]] === undefined || frontierSet[keys4[1]] === undefined ||
            frontierSet[keys4[2]] === undefined || frontierSet[keys4[3]] === undefined) continue;
        var idx4 = [frontierSet[keys4[0]], frontierSet[keys4[1]], frontierSet[keys4[2]], frontierSet[keys4[3]]];
        sumNeed = 0;
        for (c = 0; c < constraints.length; c++) {
          inds = constraints[c].indices;
          constraintTouchesOnly = true;
          for (k = 0; k < inds.length; k++) {
            if (idx4.indexOf(inds[k]) === -1) { constraintTouchesOnly = false; break; }
          }
          if (constraintTouchesOnly && inds.length > 0) sumNeed += constraints[c].need;
        }
        if (sumNeed === 2) {
          quads.push([frontier[idx4[0]], frontier[idx4[1]], frontier[idx4[2]], frontier[idx4[3]]]);
        }
      }
    }
    return { pairs: pairs, quads: quads };
  }

  function countHiddenNeighbors(x, y) {
    var n = 0;
    for (var d = 0; d < dirs.length; d++) {
      var nx = x + dirs[d][0], ny = y + dirs[d][1];
      if (inBounds(nx, ny)) {
        var c = grid[idxOf(nx, ny)];
        if (!c.revealed && !c.flagged) n++;
      }
    }
    return n;
  }

  function guessingLogic(probs, frontier, frontierSet, totalSolutions) {
    var safest = 1;
    var i, k, p, x, y, nx, ny, adjKey, maxAdjP, score, progressBonus;
    for (i = 0; i < frontier.length; i++) {
      k = key(frontier[i][0], frontier[i][1]);
      p = probs[k];
      if (p < safest) safest = p;
    }
    var cutoff = (totalSolutions > 0 && totalSolutions <= BRUTE_FORCE_MAX_SOLUTIONS)
      ? Math.min(1, safest + 0.01)
      : Math.min(1, safest + 0.15);
    var candidates = [];
    for (i = 0; i < frontier.length; i++) {
      x = frontier[i][0];
      y = frontier[i][1];
      k = key(x, y);
      p = probs[k];
      if (p > cutoff) continue;
      maxAdjP = 0;
      for (var d = 0; d < dirs.length; d++) {
        nx = x + dirs[d][0];
        ny = y + dirs[d][1];
        if (inBounds(nx, ny)) {
          adjKey = key(nx, ny);
          if (probs[adjKey] !== undefined && probs[adjKey] > maxAdjP) maxAdjP = probs[adjKey];
        }
      }
      progressBonus = countHiddenNeighbors(x, y) / 8;
      score = (1 - p) + 0.2 * (1 - maxAdjP) + 0.08 * progressBonus;
      candidates.push({ x: x, y: y, p: p, score: score });
    }
    if (candidates.length === 0) return null;
    candidates.sort(function (a, b) { return b.score - a.score; });
    return [candidates[0].x, candidates[0].y];
  }

  function fullSolver(acceptGuesses) {
    var trivial = trivialAnalysis();
    if (trivial && (trivial.toReveal.length > 0 || trivial.toFlag.length > 0)) {
      return { toReveal: trivial.toReveal, toFlag: trivial.toFlag, guess: null, method: 'trivial' };
    }

    var frontier = getFrontier();
    if (frontier.length === 0) return null;

    var frontierSet = {};
    for (var i = 0; i < frontier.length; i++) {
      frontierSet[key(frontier[i][0], frontier[i][1])] = i;
    }
    var constraints = getConstraints(frontierSet);
    var remainingMines = MINES - flagCount;
    var totalHidden = W * H - revealedCount - flagCount;
    var otherHiddenCount = totalHidden - frontier.length;

    if (frontier.length > MAX_FRONTIER_FOR_PROB) {
      var guessCell = frontier[(Math.random() * frontier.length) | 0];
      if (acceptGuesses) return { toReveal: [], toFlag: [], guess: guessCell, method: 'random' };
      return { toReveal: [], toFlag: [], guess: null, method: 'stuck' };
    }

    var result = probabilityEngine(frontier, constraints, remainingMines, otherHiddenCount);
    var probs = result.probs;
    var totalSolutions = result.totalSolutions;

    var safeReveal = [];
    var toFlag = [];
    for (i = 0; i < frontier.length; i++) {
      var keyStr = key(frontier[i][0], frontier[i][1]);
      var prob = probs[keyStr];
      if (prob <= 0) safeReveal.push(frontier[i]);
      if (prob >= 1) toFlag.push(frontier[i]);
    }
    if (safeReveal.length > 0 || toFlag.length > 0) {
      return { toReveal: safeReveal, toFlag: toFlag, guess: null, method: 'probability' };
    }

    var fifty50 = find5050(frontier, constraints, frontierSet);
    var pick = null;
    var pickMethod = null;
    if (fifty50.quads.length > 0) {
      var quad = fifty50.quads[0];
      pick = quad[0];
      if (totalSolutions > 0 && totalSolutions <= BRUTE_FORCE_MAX_SOLUTIONS) {
        var bestP = 1;
        for (var qi = 0; qi < quad.length; qi++) {
          var qp = probs[key(quad[qi][0], quad[qi][1])];
          if (qp < bestP) { bestP = qp; pick = quad[qi]; }
        }
      }
      pickMethod = '2x2';
    } else if (fifty50.pairs.length > 0) {
      var pair = fifty50.pairs[0];
      pick = pair[0];
      if (totalSolutions > 0 && totalSolutions <= BRUTE_FORCE_MAX_SOLUTIONS) {
        var p0 = probs[key(pair[0][0], pair[0][1])];
        var p1 = probs[key(pair[1][0], pair[1][1])];
        pick = (p0 <= p1) ? pair[0] : pair[1];
      }
      pickMethod = '50/50';
    }
    if (pick) {
      if (acceptGuesses) return { toReveal: [], toFlag: [], guess: pick, method: pickMethod };
      return { toReveal: [], toFlag: [], guess: pick, method: pickMethod };
    }

    var bestGuess = guessingLogic(probs, frontier, frontierSet, totalSolutions);
    if (bestGuess && acceptGuesses) {
      var method = (totalSolutions > 0 && totalSolutions <= BRUTE_FORCE_MAX_SOLUTIONS)
        ? 'brute-force'
        : 'guessing';
      return { toReveal: [], toFlag: [], guess: bestGuess, method: method };
    }
    if (bestGuess) return { toReveal: [], toFlag: [], guess: bestGuess, method: 'guessing' };
    return null;
  }

  function runAutosolve() {
    if (gameOver) return;
    if (!grid.length || firstClick) {
      setStatus('<b>Status:</b> Make at least one click to start the board, then run Autosolve.', '');
      return;
    }
    isAutosolving = true;
    startTimer();

    var total = W * H - MINES;
    var acceptGuesses = true;
    var maxSteps = 500;
    var steps = 0;
    var move, i, xy;

    while (!gameOver && revealedCount < total && steps < maxSteps) {
      steps++;
      move = fullSolver(acceptGuesses);
      if (!move) break;

      for (i = 0; i < move.toFlag.length; i++) {
        xy = move.toFlag[i];
        if (!grid[idxOf(xy[0], xy[1])].flagged) {
          toggleFlag(xy[0], xy[1]);
        }
      }
      for (i = 0; i < move.toReveal.length; i++) {
        xy = move.toReveal[i];
        if (!grid[idxOf(xy[0], xy[1])].revealed && !grid[idxOf(xy[0], xy[1])].flagged) {
          reveal(xy[0], xy[1]);
          if (gameOver) break;
        }
      }
      if (gameOver) break;
      if (move.guess && acceptGuesses) {
        xy = move.guess;
        if (!grid[idxOf(xy[0], xy[1])].revealed && !grid[idxOf(xy[0], xy[1])].flagged) {
          reveal(xy[0], xy[1]);
        }
      } else if (move.guess && !acceptGuesses) {
        setStatus('<b>Status:</b> No safe move (guess required).', '');
        break;
      } else if (move.toReveal.length === 0 && move.toFlag.length === 0 && !move.guess) {
        break;
      }
    }

    if (!gameOver && revealedCount < total) {
      if (statusEl && statusEl.textContent.indexOf('guess') === -1) {
        setStatus('<b>Status:</b> Solver stuck. Try clicking once and Autosolve again.', '');
      }
    }

    isAutosolving = false;
    if (statusEl && !gameOver && revealedCount < total && statusEl.textContent.indexOf('guess') === -1) {
      setStatus('<b>Status:</b> Solver stuck. Try clicking once and Autosolve again.', '');
    }

    if (autoplayActive) {
      var totalSafe = W * H - MINES;
      var won = (revealedCount >= totalSafe);
      autoplayGames++;
      if (won) autoplayWins++;
      autoplayResults.push(won);
      var capEl = document.getElementById('minesweeper-chart-caption');
      if (capEl) capEl.textContent = 'Games: ' + autoplayGames + ' — Win ratio: ' + ((autoplayWins / autoplayGames) * 100).toFixed(1) + '%';
      drawWinRatioChart();
      setTimeout(function () {
        if (!autoplayActive) return;
        newGame();
        setTimeout(autoplayRound, AUTOPLAY_START_DELAY_MS);
      }, autoplayPauseMs);
    }
  }

  function autoplayRound() {
    if (!autoplayActive || gameOver) return;
    if (firstClick) {
      var cx, cy;
      if (W === 30 && H === 16 && MINES === 99) {
        cx = 3;
        cy = 3;
      } else if (W >= 20 && MINES >= 40) {
        cx = Math.min(3, Math.floor(W / 2));
        cy = Math.min(3, Math.floor(H / 2));
      } else {
        cx = Math.floor(W / 2);
        cy = Math.floor(H / 2);
      }
      reveal(cx, cy);
    }
    runAutosolve();
  }

  function drawWinRatioChart() {
    var chartEl = document.getElementById('minesweeper-win-chart');
    var chartCaptionEl = document.getElementById('minesweeper-chart-caption');
    if (!chartEl || !chartEl.getContext) {
      if (chartCaptionEl && autoplayResults.length > 0) {
        chartCaptionEl.textContent = 'Games: ' + autoplayGames + ' — Win ratio: ' + ((autoplayWins / autoplayGames) * 100).toFixed(1) + '%';
      }
      return;
    }
    var ctx = chartEl.getContext('2d');
    var w = chartEl.width;
    var h = chartEl.height;
    var padding = { left: 44, right: 20, top: 20, bottom: 32 };
    var plotLeft = padding.left;
    var plotRight = w - padding.right;
    var plotTop = padding.top;
    var plotBottom = h - padding.bottom;
    var plotW = plotRight - plotLeft;
    var plotH = plotBottom - plotTop;

    ctx.clearRect(0, 0, w, h);

    var n = autoplayResults.length;
    var maxX = Math.max(n, 1);
    var minY = 0;
    var maxY = 1;

    ctx.strokeStyle = 'rgba(255,255,255,.15)';
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(159,176,199,.9)';

    for (var i = 0; i <= 5; i++) {
      var y = plotTop + (plotH * (1 - i / 5));
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotRight, y);
      ctx.stroke();
      if (i > 0 && i < 5) {
        var label = (i * 0.2).toFixed(1);
        ctx.fillText(label, 4, y + 4);
      }
    }
    var gridStepX = n > 20 ? Math.floor(n / 10) : n > 5 ? 2 : 1;
    if (gridStepX < 1) gridStepX = 1;
    for (var g = gridStepX; g < n; g += gridStepX) {
      var x = plotLeft + (plotW * (g / maxX));
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, plotBottom);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(plotLeft, plotTop);
    ctx.lineTo(plotLeft, plotBottom);
    ctx.lineTo(plotRight, plotBottom);
    ctx.stroke();

    ctx.fillText('0', plotLeft - 6, plotBottom + 14);
    ctx.fillText(String(n), plotRight - (n >= 10 ? 14 : 6), plotBottom + 14);

    if (n === 0) {
      if (chartCaptionEl) chartCaptionEl.textContent = 'Games: 0 — Win ratio: —';
      return;
    }

    var ratio = autoplayWins / autoplayGames;
    var pts = [];
    var winsSoFar = 0;
    for (var i = 0; i < n; i++) {
      if (autoplayResults[i]) winsSoFar++;
      pts.push({ x: (i + 1) / maxX, y: winsSoFar / (i + 1) });
    }

    ctx.strokeStyle = '#6aa8ff';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (var j = 0; j < pts.length; j++) {
      var px = plotLeft + pts[j].x * plotW;
      var py = plotBottom - pts[j].y * plotH;
      if (j === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    if (chartCaptionEl) {
      chartCaptionEl.textContent = 'Games: ' + n + ' — Win ratio: ' + (ratio * 100).toFixed(1) + '%';
    }
  }

  function newGame() {
    validateAndClamp();
    gameOver = false;
    firstClick = true;
    revealedCount = 0;
    flagCount = 0;
    boomCell = null;
    hovered = null;
    setFace('🙂');
    resetTimer();

    boardEl.style.setProperty('--rlms-cell', W >= 30 ? '24px' : (W >= 20 ? '26px' : '28px'));
    boardEl.style.gridTemplateColumns = 'repeat(' + W + ', var(--rlms-cell))';

    grid = [];
    for (var i = 0; i < W * H; i++) {
      grid.push({ mine: false, adj: 0, revealed: false, flagged: false, el: null });
    }

    boardEl.innerHTML = '';
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var idx = idxOf(x, y);
        var d = document.createElement('div');
        d.className = 'rlms-cell';
        d.setAttribute('role', 'button');
        d.setAttribute('tabindex', '-1');
        d.setAttribute('aria-label', 'cell ' + (x + 1) + ',' + (y + 1));
        d.dataset.x = x;
        d.dataset.y = y;

        d.addEventListener('mouseenter', function (xx, yy) {
          return function () { hovered = { x: xx, y: yy }; };
        }(x, y));
        d.addEventListener('mouseleave', function (xx, yy) {
          return function () {
            if (hovered && hovered.x === xx && hovered.y === yy) hovered = null;
          };
        }(x, y));

        d.addEventListener('mousedown', function (e) {
          if (gameOver) return;
          if (e.button === 0) setFace('😮');
        });

        d.addEventListener('mouseup', function () {
          if (gameOver) return;
          setFace('🙂');
        });

        grid[idx].el = d;
        boardEl.appendChild(d);
      }
    }

    updateMinesLeft();
    setStatus('<b>Status:</b> Ready. <span class="rlms-kbd">Right-click</span> to flag, <span class="rlms-kbd">Space</span> while hovering to flag, <span class="rlms-kbd">Shift+click</span>/<span class="rlms-kbd">Middle-click</span> or <span class="rlms-kbd">Space</span> on a number to chord. Game vibe coded by David Parkinson and GPT; autosolver based on David Hill.', '');
  }

  function getCellFromEvent(e) {
    return getCellFromElement(e.target.closest('.rlms-cell'));
  }

  function getCellFromElement(el) {
    if (!el || el.dataset.x === undefined || el.dataset.y === undefined) return null;
    var x = parseInt(el.dataset.x, 10);
    var y = parseInt(el.dataset.y, 10);
    if (isNaN(x) || isNaN(y)) return null;
    return { x: x, y: y };
  }

  var longPressTimer = null;
  var longPressCell = null;
  var lastLongPressCell = null;
  var lastLongPressTime = 0;
  var LONG_PRESS_MS = 450;
  var LONG_PRESS_SUPPRESS_MS = 400;

  boardEl.addEventListener('touchstart', function (e) {
    if (gameOver || e.touches.length !== 1) return;
    var cell = getCellFromElement(e.target.closest('.rlms-cell'));
    if (!cell) return;
    longPressCell = cell;
    longPressTimer = setTimeout(function () {
      longPressTimer = null;
      if (longPressCell) {
        toggleFlag(longPressCell.x, longPressCell.y);
        lastLongPressCell = { x: longPressCell.x, y: longPressCell.y };
        lastLongPressTime = Date.now();
        longPressCell = null;
      }
    }, LONG_PRESS_MS);
  }, { passive: true });

  boardEl.addEventListener('touchend', function (e) {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressCell = null;
  }, { passive: true });

  boardEl.addEventListener('touchcancel', function (e) {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressCell = null;
  }, { passive: true });

  boardEl.addEventListener('click', function (e) {
    var cell = getCellFromEvent(e);
    if (!cell || gameOver) return;
    if (lastLongPressCell && cell.x === lastLongPressCell.x && cell.y === lastLongPressCell.y && (Date.now() - lastLongPressTime) < LONG_PRESS_SUPPRESS_MS) {
      lastLongPressCell = null;
      return;
    }
    if (e.shiftKey) chord(cell.x, cell.y);
    else reveal(cell.x, cell.y);
  });

  boardEl.addEventListener('auxclick', function (e) {
    if (e.button !== 1) return;
    var cell = getCellFromEvent(e);
    if (!cell || gameOver) return;
    e.preventDefault();
    chord(cell.x, cell.y);
  });

  boardEl.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    var cell = getCellFromEvent(e);
    if (!cell || gameOver) return;
    toggleFlag(cell.x, cell.y);
  });

  window.addEventListener('keydown', function (e) {
    if ((e.key === ' ' || e.key === 'Spacebar' || e.code === 'Space') && hovered && !gameOver) {
      e.preventDefault();
      var x = hovered.x, y = hovered.y;
      var c = grid[idxOf(x, y)];
      if (c.revealed && c.adj > 0) chord(x, y);
      else if (!c.revealed) toggleFlag(x, y);
    }
  }, { passive: false });

  if (presetEl) presetEl.addEventListener('change', function () {
    if (presetEl.value !== 'custom') {
      applyPreset();
      newGame();
    }
  });

  [wEl, hEl, mEl].forEach(function (el) {
    if (el) el.addEventListener('input', function () { if (presetEl) presetEl.value = 'custom'; });
  });

  function stopAutoplayUI() {
    var btn = document.getElementById('minesweeper-autoplay');
    if (btn) btn.textContent = 'Autoplay';
  }

  if (newBtn) newBtn.addEventListener('click', function () {
    if (autoplayActive) {
      autoplayActive = false;
      stopAutoplayUI();
    }
    applyPreset();
    newGame();
  });

  if (resetBtn) resetBtn.addEventListener('click', function () {
    if (autoplayActive) {
      autoplayActive = false;
      stopAutoplayUI();
    }
    if (presetEl) presetEl.value = 'beginner';
    applyPreset();
    newGame();
  });

  if (faceEl) faceEl.addEventListener('click', function () {
    if (autoplayActive) {
      autoplayActive = false;
      stopAutoplayUI();
    }
    newGame();
  });

  if (autosolveBtn) autosolveBtn.addEventListener('click', runAutosolve);

  function handleAutoplayClick() {
    autoplayActive = !autoplayActive;
    var btn = document.getElementById('minesweeper-autoplay');
    if (btn) btn.textContent = autoplayActive ? 'Stop Autoplay' : 'Autoplay';
    if (autoplayActive) {
      newGame();
      setTimeout(autoplayRound, AUTOPLAY_START_DELAY_MS);
    }
  }

  function updatePauseDisplay() {
    var el = document.getElementById('minesweeper-pause-value');
    if (el) el.textContent = (autoplayPauseMs / 1000).toFixed(1) + ' s';
  }

  var gameContainer = document.querySelector('.rlms-game');
  if (gameContainer) {
    gameContainer.addEventListener('click', function (e) {
      var el = e.target;
      while (el && el !== gameContainer) {
        var action = el.getAttribute && el.getAttribute('data-rlms-action');
        if (action === 'autoplay') {
          e.preventDefault();
          e.stopPropagation();
          handleAutoplayClick();
          return;
        }
        if (action === 'pause-minus') {
          e.preventDefault();
          e.stopPropagation();
          autoplayPauseMs = Math.max(200, autoplayPauseMs - 200);
          updatePauseDisplay();
          return;
        }
        if (action === 'pause-plus') {
          e.preventDefault();
          e.stopPropagation();
          autoplayPauseMs = Math.min(5000, autoplayPauseMs + 200);
          updatePauseDisplay();
          return;
        }
        el = el.parentNode;
      }
    });
  }

  updatePauseDisplay();
  drawWinRatioChart();

  applyPreset();
  newGame();
})();
