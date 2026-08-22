// 現地調査モード(最小版)
// ?survey=1 で有効。床をタップ → 種別を選んで保存 → localStorage に蓄積 → JSONで書き出す。
// 座標は現行の地図座標(mx,my = 旧案内図px。frame: legacy-px-v1)。土台切替後に変換する。
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const STORAGE_KEY = 'survey_v1';
const FRAME = 'legacy-px-v1';

// 種別: 2点ものは two=true。to=true は「どこへ」を聞く
export const TYPES = {
  stairs:   { label: '階段',        color: 0x9aa6b8, to: true },
  ev:       { label: 'EV',          color: 0x7aa7ff, to: true },
  esc:      { label: 'ESC',         color: 0xffc23d, to: true },
  wall:     { label: '壁・行き止まり', color: 0xff5a5a, two: true },
  corridor: { label: '通路あり',    color: 0x7dffce, two: true },
  exit:     { label: '出口番号',    color: 0xffffff, exit: true },
  shop:     { label: '店',          color: 0xffa8cd },
  memo:     { label: 'メモ',        color: 0xc8a2ff },
};
const FLOOR_SIGNS = ['B2F', 'B1F', '1F', '2F'];
const FLOOR_ORDER = ['S1', 'B1', 'B2']; // タップ面の既定は表示中の最上位

export function initSurvey({ camera, floorGroups, FLOOR_Y, ZONES, w2m }) {
  const $ = id => document.getElementById(id);
  const bar = $('survey');
  if (!bar) throw new Error('#survey がありません');

  // ---- 状態 ----
  let records = load();
  let selType = 'stairs';
  let floorSign = 'B1F';
  let pending = null;   // 2点ものの1点目 { p, floor, zone, marker }
  let draft = null;     // フォーム表示中の記録(未保存) { rec, markers }
  const markers = new Map(); // rec.id -> { meshes:[], labels:[] }
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // ---- UI ----
  const typesEl = $('sv-types'), floorEl = $('sv-floor'), toEl = $('sv-to');
  for (const [key, t] of Object.entries(TYPES)) {
    const c = chip(t.label, () => { selType = key; renderChips(); say(`${t.label}: 床をタップ`); });
    c.dataset.type = key; typesEl.appendChild(c);
  }
  for (const s of FLOOR_SIGNS) {
    const c = chip(s, () => { floorSign = s; renderChips(); });
    c.dataset.sign = s; floorEl.appendChild(c);
  }
  for (const s of FLOOR_SIGNS) {
    const c = chip(s, () => { if (draft) { draft.rec.to = draft.rec.to === s ? null : s; renderChips(); } });
    c.dataset.to = s; toEl.appendChild(c);
  }
  $('sv-undo').addEventListener('click', undoLast);
  $('sv-export').addEventListener('click', exportJson);
  $('sv-clear').addEventListener('click', () => {
    if (records.length && confirm(`${records.length}件の記録を全部消しますか?`)) { records = []; save(); rebuildMarkers(); say('全消去しました'); }
  });
  $('sv-save').addEventListener('click', saveDraft);
  $('sv-cancel').addEventListener('click', cancelDraft);
  $('sv-copy').addEventListener('click', copyExport);
  $('sv-close').addEventListener('click', () => { $('sv-exportbox').hidden = true; });
  const gpsBtn = $('sv-gps');
  if (!navigator.geolocation) gpsBtn.hidden = true;
  gpsBtn.addEventListener('click', () => {
    if (!draft) return;
    gpsBtn.disabled = true; gpsBtn.textContent = 'GPS取得中…';
    navigator.geolocation.getCurrentPosition(pos => {
      draft.rec.gps = { lat: +pos.coords.latitude.toFixed(6), lon: +pos.coords.longitude.toFixed(6), acc: Math.round(pos.coords.accuracy) };
      gpsBtn.disabled = false; gpsBtn.textContent = `GPS ±${draft.rec.gps.acc}m 付けました`;
    }, err => {
      gpsBtn.disabled = false; gpsBtn.textContent = 'GPS取得(失敗。もう一度)';
      say(`GPS失敗: ${err.message}`);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });

  rebuildMarkers();
  renderChips();
  say('種別を選んで床をタップ');

  // ---- タップ ----
  function onTap(e) {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (draft) { say('保存かキャンセルをしてから次へ'); return; }

    // 既存マーカーをタップ → 削除
    const mk = raycaster.intersectObjects([...markers.values()].flatMap(m => m.meshes))[0];
    if (mk) {
      const id = mk.object.userData.surveyId;
      const rec = records.find(r => r.id === id);
      if (rec && confirm(`${describe(rec)} を削除しますか?`)) { records = records.filter(r => r.id !== id); save(); rebuildMarkers(); }
      return;
    }

    const hit = hitFloor();
    if (!hit) { say('床が見つかりません。階の表示を確認'); return; }
    const t = TYPES[selType];
    if (t.two && !pending) {
      pending = { ...hit, marker: tempMarker(hit, t.color) };
      say(`${t.label}: 2点目をタップ`);
      return;
    }
    const rec = {
      id: 'r' + Date.now().toString(36), ts: new Date().toISOString(), type: selType,
      zone: (pending || hit).zone, floor: (pending || hit).floor, floorSign,
      px: (pending || hit).px, px2: pending ? hit.px : null,
      to: null, exit: null, note: '', gps: null,
    };
    if (pending) { removeTemp(pending.marker); pending = null; }
    draft = { rec, hit2: hit };
    openForm(rec);
  }

  function hitFloor() {
    const visible = FLOOR_ORDER.filter(f => floorGroups[f].visible);
    const targets = visible.flatMap(f => floorGroups[f].children.filter(o => o.isMesh && o.visible));
    const hit = raycaster.intersectObjects(targets, false)[0];
    if (hit) {
      let o = hit.object, floor = null;
      while (o) { const f = FLOOR_ORDER.find(k => floorGroups[k] === o); if (f) { floor = f; break; } o = o.parent; }
      const [mx, my] = w2m([hit.point.x, hit.point.z]);
      return { px: [r1(mx), r1(my)], floor: floor || visible[0] || 'B1', zone: hit.object.userData.zone || nearestZone(mx, my), world: hit.point.clone() };
    }
    // 床の隙間をタップした場合: 表示中の各階の平面との交点のうち、その階の床区画に一番近いものを採る
    let best = null;
    for (const floor of visible) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_Y[floor]);
      const p = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, p)) continue;
      let d = Infinity, zone = null;
      for (const { pts, zone: z } of floorOutlines(floor)) {
        for (let i = 0; i < pts.length; i += 2) {
          const dd = Math.hypot(pts[i] - p.x, pts[i + 1] - p.z);
          if (dd < d) { d = dd; zone = z; }
        }
      }
      if (!best || d < best.d) best = { floor, p, d, zone };
    }
    if (!best) return null;
    const [mx, my] = w2m([best.p.x, best.p.z]);
    return { px: [r1(mx), r1(my)], floor: best.floor, zone: best.zone || nearestZone(mx, my), world: best.p };
  }
  // 各階の床区画(押し出しメッシュ)の頂点をワールド座標(x,z)で持つ。隙間タップ時の「近い階」判定用
  const outlineCache = {};
  function floorOutlines(floor) {
    if (!outlineCache[floor]) {
      const v = new THREE.Vector3();
      outlineCache[floor] = floorGroups[floor].children
        .filter(o => o.isMesh && o.geometry?.type === 'ExtrudeGeometry')
        .map(o => {
          const pos = o.geometry.attributes.position, pts = [];
          o.updateMatrixWorld(true);
          for (let i = 0; i < pos.count; i += 3) { // 間引き(頂点は輪郭上に並ぶので十分)
            v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
            pts.push(v.x, v.z);
          }
          return { pts, zone: o.userData.zone };
        });
    }
    return outlineCache[floor];
  }
  function nearestZone(mx, my) {
    let best = '?', bd = 1e9;
    for (const [k, z] of Object.entries(ZONES)) {
      const d = Math.hypot(z.label[0] - mx, z.label[1] - my);
      if (d < bd) { bd = d; best = k; }
    }
    return bd < 120 ? best : '?';
  }

  // ---- フォーム ----
  function openForm(rec) {
    const t = TYPES[rec.type];
    $('sv-form').hidden = false;
    $('sv-form-title').textContent = `${t.label} @ ${rec.zone} ${rec.floorSign} (${rec.px.join(', ')})`;
    $('sv-to-row').hidden = !t.to;
    $('sv-exit-row').hidden = !t.exit;
    $('sv-exit').value = '';
    $('sv-note').value = '';
    gpsBtn.disabled = false; gpsBtn.textContent = 'GPSを付ける';
    renderChips();
    if (t.exit) $('sv-exit').focus();
  }
  function saveDraft() {
    if (!draft) return;
    const rec = draft.rec;
    rec.exit = $('sv-exit').value.trim() || null;
    rec.note = $('sv-note').value.trim();
    records.push(rec); save();
    addMarker(rec);
    draft = null; $('sv-form').hidden = true;
    say(`保存: ${describe(rec)}`);
  }
  function cancelDraft() { draft = null; $('sv-form').hidden = true; say('キャンセル'); }
  function undoLast() {
    if (pending) { removeTemp(pending.marker); pending = null; say('1点目を取り消し'); return; }
    if (draft) { cancelDraft(); return; }
    const rec = records.pop(); if (!rec) return;
    save(); rebuildMarkers(); say(`取り消し: ${describe(rec)}`);
  }

  // ---- マーカー ----
  function addMarker(rec) {
    const t = TYPES[rec.type] || TYPES.memo;
    const y = FLOOR_Y[rec.floor] ?? FLOOR_Y.B1;
    const g = floorGroups[rec.floor] || floorGroups.B1;
    const mat = new THREE.MeshBasicMaterial({ color: t.color });
    const meshes = [], labels = [];
    const mk = (px, big) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(big ? 1.6 : 1.0, big ? 1.6 : 1.0, 5, 10), mat);
      const [x, z] = m2w(px); m.position.set(x, y + 2.5, z);
      m.userData.surveyId = rec.id; m.renderOrder = 5; g.add(m); meshes.push(m); return m;
    };
    const m1 = mk(rec.px, true);
    const div = document.createElement('div');
    div.className = 'sv-label'; div.textContent = shortLabel(rec);
    const label = new CSS2DObject(div); label.position.set(0, 4, 0); m1.add(label); labels.push(label);
    if (rec.px2) {
      mk(rec.px2, false);
      const [x1, z1] = m2w(rec.px), [x2, z2] = m2w(rec.px2);
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x1, y + 2.5, z1), new THREE.Vector3(x2, y + 2.5, z2)]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: t.color }));
      g.add(line); meshes.push(line);
    }
    markers.set(rec.id, { meshes, labels });
  }
  function rebuildMarkers() {
    for (const { meshes } of markers.values()) for (const m of meshes) m.parent?.remove(m);
    markers.clear();
    for (const r of records) addMarker(r);
    $('sv-count').textContent = `${records.length}件`;
  }
  function tempMarker(hit, color) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 5, 10), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 }));
    m.position.set(hit.world.x, FLOOR_Y[hit.floor] + 2.5, hit.world.z);
    floorGroups[hit.floor].add(m); return m;
  }
  function removeTemp(m) { m.parent?.remove(m); }
  function m2w([mx, my]) { return [(mx - 800) * 0.5, (my - 1100) * 0.5]; }

  // ---- 保存・書き出し ----
  function load() {
    try { const d = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); return Array.isArray(d?.records) ? d.records : []; }
    catch { return []; }
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, frame: FRAME, records }));
    $('sv-count').textContent = `${records.length}件`;
  }
  function exportText() {
    return JSON.stringify({ version: 1, frame: FRAME, exported: new Date().toISOString(), records }, null, 1);
  }
  async function exportJson() {
    if (!records.length) { say('記録がありません'); return; }
    const text = exportText();
    if (navigator.share) {
      try { await navigator.share({ title: `梅田調査 ${records.length}件`, text }); say('共有しました'); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    $('sv-textarea').value = text; $('sv-exportbox').hidden = false;
  }
  async function copyExport() {
    const ta = $('sv-textarea');
    try { await navigator.clipboard.writeText(ta.value); say('コピーしました'); }
    catch { ta.focus(); ta.select(); say('全選択しました。コピーしてください'); }
  }

  // ---- 小物 ----
  function chip(text, onClick) {
    const c = document.createElement('div'); c.className = 'sv-chip'; c.textContent = text;
    c.addEventListener('click', onClick); return c;
  }
  function renderChips() {
    for (const c of typesEl.children) c.classList.toggle('on', c.dataset.type === selType);
    for (const c of floorEl.children) c.classList.toggle('on', c.dataset.sign === floorSign);
    for (const c of toEl.children) c.classList.toggle('on', !!draft && c.dataset.to === draft.rec.to);
  }
  function say(msg) { $('sv-msg').textContent = msg; }
  function describe(rec) {
    const t = TYPES[rec.type]?.label || rec.type;
    return `${t}${rec.exit ? ' ' + rec.exit : ''}${rec.to ? '→' + rec.to : ''} (${rec.px.join(',')})`;
  }
  function shortLabel(rec) {
    const t = TYPES[rec.type]?.label || rec.type;
    return rec.exit ? `出口 ${rec.exit}` : rec.to ? `${t}→${rec.to}` : rec.note ? `${t}: ${rec.note.slice(0, 10)}` : t;
  }
  function r1(v) { return Math.round(v * 10) / 10; }

  return { active: true, onTap };
}
