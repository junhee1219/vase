// VASE — 순수 게임 로직 (브라우저 + node test.js 공용, DOM 의존 없음)
// 판 생성은 랜덤 셔플 그대로 두되, 한정 솔버로 "풀 수 있는 판"인지 확인하고
// 막힌 판이면 다시 섞는다. 솔버가 찾은 풀이 길이가 별점 기준(par)이 된다.
const VaseCore = (() => {
  const CAP = 4; // 병 하나의 용량(층 수)

  // ── 기본 규칙 ──
  const topColor = (t) => (t.length ? t[t.length - 1] : null);

  function topCount(t) {
    if (!t.length) return 0;
    const c = t[t.length - 1];
    let n = 0;
    for (let i = t.length - 1; i >= 0 && t[i] === c; i--) n++;
    return n;
  }

  function canPour(tubes, f, to) {
    if (f === to) return false;
    const a = tubes[f], b = tubes[to];
    if (!a || !b) return false;
    if (!a.length) return false;
    if (b.length >= CAP) return false;
    if (!b.length) return true;
    return topColor(a) === topColor(b);
  }

  const pourAmount = (tubes, f, to) =>
    Math.min(topCount(tubes[f]), CAP - tubes[to].length);

  // 새 상태를 돌려준다 (원본 불변)
  function applyPour(tubes, f, to) {
    const n = pourAmount(tubes, f, to);
    const next = tubes.map((t, i) => (i === f || i === to ? t.slice() : t));
    for (let i = 0; i < n; i++) next[to].push(next[f].pop());
    return next;
  }

  const isComplete = (t) => t.length === CAP && t.every((c) => c === t[0]);
  const isWin = (tubes) => tubes.every((t) => t.length === 0 || isComplete(t));

  // ── 판 생성 ──
  // sizes: 병별 유닛 수 배열 (0 = 빈 병). 합은 numColors*CAP 이어야 한다.
  function generateBoard(numColors, sizes, rng) {
    rng = rng || Math.random;
    const pool = [];
    for (let c = 0; c < numColors; c++) for (let i = 0; i < CAP; i++) pool.push(c);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const tubes = [];
    let p = 0;
    for (const s of sizes) { tubes.push(pool.slice(p, p + s)); p += s; }
    return tubes;
  }

  // 고전 구성: 꽉 찬 병 numColors개 + 빈 병 empties개
  function sizesFor(numColors, empties) {
    const sizes = Array(numColors).fill(CAP);
    for (let e = 0; e < empties; e++) sizes.push(0);
    return sizes;
  }

  // ── 난이도 곡선 ──
  // 레벨이 오를수록 빈 병이 줄고, 고레벨(11+)은 빈 병 0개 —
  // 대신 "꽉 차지 않은 병"의 수(=여유 공간)로 난이도를 조절한다.
  // N = 물이 든 병 수, E = 빈 병 수. 여유 공간 = N*CAP - 32 + E*CAP
  function levelSizes(level, numColors, rng) {
    rng = rng || Math.random;
    const U = numColors * CAP;
    let N, E;
    if (level <= 2)       { N = numColors;     E = 4; } // 입문: 빈 병 4
    else if (level <= 4)  { N = numColors;     E = 3; }
    else if (level <= 6)  { N = numColors;     E = 2; }
    else if (level <= 8)  { N = numColors + 2; E = 1; } // 부분 충전 병 등장
    else if (level <= 10) { N = numColors + 1; E = 1; }
    else if (level <= 12) { N = numColors + 4; E = 0; } // 빈 병 제로
    else if (level <= 14) { N = numColors + 3; E = 0; }
    else if (level <= 16) { N = numColors + 2; E = 0; }
    else                  { N = numColors + 1; E = 0; } // 최고 난이도: 여유 4칸
    const sizes = Array(N).fill(CAP);
    let shed = CAP * N - U; // 덜어낼 유닛 수 → 부분 충전 병이 생긴다
    while (shed > 0) {
      const i = (rng() * N) | 0;
      if (sizes[i] > 1) { sizes[i]--; shed--; }
    }
    for (let e = 0; e < E; e++) sizes.push(0);
    return sizes;
  }

  // ── 솔버 (그리디 정렬 DFS + 정규화 방문 집합, 노드 예산 한정) ──
  // 병 순서는 의미가 없으므로 정렬해서 같은 상태로 본다 → 탐색 공간 급감
  const canon = (tubes) => tubes.map((t) => t.join(',')).sort().join('|');

  // 유망한 수부터 시도: 병 완성 > 같은 색 위에 붓기 > 병 비우기 > 빈 병은 최후
  // jitterRng를 주면 동점 근처 순서가 살짝 섞임 → 랜덤 재시작용
  function legalMoves(tubes, jitterRng) {
    const moves = [];
    let firstEmpty = -1;
    for (let i = 0; i < tubes.length; i++) {
      if (!tubes[i].length && firstEmpty < 0) firstEmpty = i;
    }
    for (let f = 0; f < tubes.length; f++) {
      const a = tubes[f];
      if (!a.length || isComplete(a)) continue;
      const aTop = topCount(a);
      const aUniform = aTop === a.length; // 병 전체가 한 색
      for (let t = 0; t < tubes.length; t++) {
        if (!canPour(tubes, f, t)) continue;
        if (!tubes[t].length) {
          if (aUniform) continue;       // 한 색짜리를 빈 병에 → 무의미
          if (t !== firstEmpty) continue; // 빈 병끼리는 대칭 → 첫 빈 병만
        }
        let score = 0;
        const n = pourAmount(tubes, f, t);
        if (tubes[t].length) {
          score += 2; // 같은 색 위에 붓기
          if (tubes[t].length + n === CAP && topCount(tubes[t]) === tubes[t].length && n === aTop) score += 3; // 완성 가능성
        } else {
          score -= 1; // 빈 병은 최후의 수단
        }
        if (n === a.length) score += 1; // 병이 완전히 비워짐
        if (jitterRng) score += jitterRng() * 0.9;
        moves.push({ f, t, score });
      }
    }
    moves.sort((x, y) => y.score - x.score);
    return moves;
  }

  // 반환: { solved, moves: [[f,t],...], nodes, exhausted }
  function solve(start, nodeBudget, jitterRng) {
    nodeBudget = nodeBudget || 80000;
    const visited = new Set([canon(start)]);
    const path = [];
    let nodes = 0;
    let exhausted = false;

    function dfs(state) {
      if (isWin(state)) return true;
      if (++nodes > nodeBudget) { exhausted = true; return false; }
      for (const { f, t } of legalMoves(state, jitterRng)) {
        const next = applyPour(state, f, t);
        const key = canon(next);
        if (visited.has(key)) continue;
        visited.add(key);
        path.push([f, t]);
        if (dfs(next)) return true;
        if (exhausted) return false;
        path.pop();
      }
      return false;
    }

    const solved = dfs(start);
    return { solved, moves: solved ? path.slice() : null, nodes, exhausted };
  }

  // 이론적 하한: 모든 색 덩어리(세그먼트)를 색당 하나로 합치는 데 필요한 최소 이동
  function countSegments(tubes) {
    let seg = 0;
    for (const t of tubes) {
      for (let i = 0; i < t.length; i++) if (i === 0 || t[i] !== t[i - 1]) seg++;
    }
    return seg;
  }

  // 주어진 sizes로 풀 수 있는 판을 찾는다 (성공 시 par = 최단 발견 풀이 길이)
  function trySolvable(numColors, sizes, rng, nodeBudget, restarts) {
    const tubes = generateBoard(numColors, sizes, rng);
    const r = solve(tubes, nodeBudget);
    if (!r.solved) return null;
    let best = r.moves;
    for (let k = 1; k < restarts; k++) {
      // 랜덤 재시작으로 더 짧은 풀이를 찾아 par를 타이트하게
      const r2 = solve(tubes, nodeBudget, rng);
      if (r2.solved && r2.moves.length < best.length) best = r2.moves;
    }
    return { tubes, par: best.length, solverMoves: best };
  }

  // 풀 수 있는 판 + par(별점 기준) 생성 (고전 구성: 꽉 찬 병 + 빈 병)
  function generateSolvableBoard(numColors, empties, opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const maxTries = opts.maxTries || 12;
    const nodeBudget = opts.nodeBudget || 80000;
    const restarts = opts.restarts || 4;
    for (let i = 0; i < maxTries; i++) {
      const found = trySolvable(numColors, sizesFor(numColors, empties), rng, nodeBudget, restarts);
      if (found) return found;
    }
    // 도달 거의 불가: 빈 병 하나 더 주고 재시도
    return generateSolvableBoard(numColors, empties + 1, opts);
  }

  // 레벨 난이도 곡선을 적용한 판 생성.
  // 타이트한 구성(여유 4칸)은 랜덤 셔플이 못 푸는 판일 수 있으므로
  // 여러 번 다시 섞고, 그래도 안 되면 빈 병을 하나씩 추가해 완화한다.
  function generateLevel(level, numColors, opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const maxTries = opts.maxTries || 24;
    const nodeBudget = opts.nodeBudget || 80000;
    const restarts = opts.restarts || 4;
    for (let relax = 0; relax <= 2; relax++) {
      for (let t = 0; t < maxTries; t++) {
        const sizes = levelSizes(level, numColors, rng);
        for (let e = 0; e < relax; e++) sizes.push(0);
        const found = trySolvable(numColors, sizes, rng, nodeBudget, restarts);
        if (found) return found;
      }
    }
    // 최후의 안전망: 고전 구성
    return generateSolvableBoard(numColors, 4, opts);
  }

  // ── 별점 ──
  // 3★: 솔버(봇)와 같거나 더 적은 이동 / 2★: par×1.5 이내 / 1★: 클리어
  function starsFor(moves, par) {
    if (moves <= par) return 3;
    if (moves <= Math.ceil(par * 1.5)) return 2;
    return 1;
  }

  return {
    CAP, topColor, topCount, canPour, pourAmount, applyPour,
    isComplete, isWin, generateBoard, sizesFor, levelSizes,
    generateSolvableBoard, generateLevel,
    solve, legalMoves, canon, countSegments, starsFor,
  };
})();

if (typeof module !== 'undefined') module.exports = VaseCore;
if (typeof window !== 'undefined') window.VaseCore = VaseCore;
