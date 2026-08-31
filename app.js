const $ = (s) => document.querySelector(s);
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const colors = ['#a94f58','#668575','#886d9c','#bd7a46','#547f9a','#8d7854','#8b5c67','#628d8a'];
const key = 'wedding-seating-v1';
let state = load() || {
  groups: [],
  tables: [
    {id:uid(),name:'主桌',comfort:12,hard:12},
    {id:uid(),name:'第 2 桌',comfort:10,hard:11}
  ], view:'list', map:{background:null,hidden:false}
};
let importRows = [], editingTableId = null, editingMemberId = null, pendingMove = null, lastUndo = null, quickPlaceMode = false, previewTableId = null, mapAspectLoading = false;

function load(){try{return JSON.parse(localStorage.getItem(key))}catch{return null}}
function persist(){try{localStorage.setItem(key,JSON.stringify(state))}catch{toast('場地圖或資料較大，瀏覽器儲存空間不足；請先下載備份。')}}
function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
// Return the actual member objects so drag, edit, undo and table counts share one source of truth.
function members(){return state.groups.flatMap(g=>g.members)}
function tableCount(id){return members().filter(m=>m.tableId===id).length}
function groupUnassigned(g){return g.members.filter(m=>!m.tableId)}
function deleteGroup(id){
  const group=state.groups.find(g=>g.id===id);if(!group)return;
  const seated=group.members.filter(m=>m.tableId).length,warning=seated?`\n\n其中 ${seated} 位已經安排入桌，刪除後也會從桌次移除。`:'';
  if(!confirm(`確定刪除群組「${group.name}」共 ${group.members.length} 位嗎？${warning}\n\n此動作無法復原。`))return;
  state.groups=state.groups.filter(g=>g.id!==id);render();toast(`已刪除群組「${group.name}」`);
}
function bindGroupDeleteButtons(){document.querySelectorAll('[data-delete-group]').forEach(button=>button.onclick=e=>{e.preventDefault();e.stopPropagation();deleteGroup(button.dataset.deleteGroup)})}
function groupColor(group){
  if(group.color)return group.color;
  const index=Math.max(0,state.groups.indexOf(group));
  const hue=Math.round((348+index*137.508)%360);
  group.color=`hsl(${hue} 36% 48%)`;
  return group.color;
}
function makeGroup(row){
  const total=Math.max(1,Number(row.count)||1), base=String(row.name||'未命名群組').trim();
  const child=Math.max(0,Number(row.child)||0), veg=Math.max(0,Number(row.veg)||0);
  return {id:uid(),category:String(row.category||'未分類').trim(),name:base,note:String(row.note||''),cnCake:Number(row.cnCake)||0,westCake:Number(row.westCake)||0,
    members:Array.from({length:total},(_,i)=>({id:uid(),name:total===1?base:`${base}${i+1}`,originalIndex:i+1,child:i<child,veg:i<veg,tableId:null}))};
}
function render(){
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
  const all=members(), assigned=all.filter(m=>m.tableId).length, total=all.length;
  const comfort=state.tables.reduce((s,t)=>s+t.comfort,0), hard=state.tables.reduce((s,t)=>s+t.hard,0);
  const extra=state.tables.reduce((s,t)=>s+Math.max(0,tableCount(t.id)-t.comfort),0);
  $('#statTotal').textContent=total; $('#statAssigned').textContent=assigned; $('#statWaiting').textContent=total-assigned;
  $('#statComfort').textContent=comfort; $('#statHard').textContent=hard; $('#statExtra').textContent=extra;
  $('#waitingBadge').textContent=state.groups.filter(g=>groupUnassigned(g).length).length;
  renderCategories(); renderWaiting(); renderTables(); persist();
}
function renderCategories(){
  const selected=$('#categoryFilter').value, cats=[...new Set(state.groups.map(g=>g.category))].sort();
  $('#categoryFilter').innerHTML='<option value="">全部分類</option>'+cats.map(c=>`<option ${c===selected?'selected':''}>${esc(c)}</option>`).join('');
}
function renderWaiting(){
  const q=$('#searchInput').value.trim().toLowerCase(), cat=$('#categoryFilter').value;
  const rows=state.groups.filter(g=>groupUnassigned(g).length).filter(g=>(!cat||g.category===cat)&&(!q||`${g.name} ${g.category} ${g.members.map(m=>m.name).join(' ')}`.toLowerCase().includes(q)));
  $('#waitingList').innerHTML=rows.length?rows.map(g=>{
    const waiting=groupUnassigned(g), assigned=g.members.length-waiting.length;
    return `<article class="group-card" draggable="true" data-drag-group="${g.id}" style="--cat:${groupColor(g)}">
      <div class="group-top"><span class="group-name">${esc(g.name)}</span><span class="group-card-actions"><span class="pill">${waiting.length} 位</span><button type="button" class="delete-group-button" data-delete-group="${g.id}" title="刪除整個群組">刪除</button></span></div>
      <div class="group-meta">${esc(g.category)}${assigned?` · 已安排 ${assigned}/${g.members.length}`:''}</div>
      <div class="group-badges">${waiting.filter(m=>m.child).length?`<span class="badge">兒童椅 ${waiting.filter(m=>m.child).length}</span>`:''}${waiting.filter(m=>m.veg).length?`<span class="badge">素食 ${waiting.filter(m=>m.veg).length}</span>`:''}${g.note?`<span class="badge">${esc(g.note)}</span>`:''}</div>
    </article>`}).join(''):'<div class="empty-state">目前沒有待分配群組。<br>可匯入 Excel 或手動新增。</div>';
  bindDrags();
  bindGroupDeleteButtons();
  const waiting=$('#waitingList');waiting.ondragover=e=>e.preventDefault();waiting.ondrop=e=>{e.preventDefault();try{const p=JSON.parse(e.dataTransfer.getData('application/json'));applyMove(p.memberIds,null)}catch{toast('無法辨識拖曳內容')}};
}
function renderTables(){
  state.map=state.map||{background:null,hidden:false};
  const board=$('#tableBoard'), seatMapMode=state.view==='map', venueView=state.view==='venue', venueMode=venueView&&!!state.map.background;
  $('#mapTools').hidden=!venueView;
  $('#toggleBackgroundBtn').style.display=state.map.background?'inline-block':'none';$('#clearBackgroundBtn').style.display=state.map.background?'inline-block':'none';
  $('#quickPlaceBtn').style.display=state.map.background?'inline-block':'none';$('#quickPlaceBtn').textContent=quickPlaceMode?'結束快速標記':'快速標記桌位';
  $('#toggleBackgroundBtn').textContent=state.map.hidden?'顯示底圖':'隱藏底圖';
  board.className=`table-board ${seatMapMode||venueView?'map-view':'list-view'} ${venueMode?'venue-mode':''} ${quickPlaceMode&&venueMode?'quick-place':''}`;
  board.style.backgroundImage='none';board.style.aspectRatio=venueMode&&state.map.aspect?String(state.map.aspect):'auto';board.style.setProperty('--venue-aspect',state.map.aspect||1.5);
  if(venueMode&&!state.map.aspect&&!mapAspectLoading){mapAspectLoading=true;const image=new Image();image.onload=()=>{state.map.aspect=image.naturalWidth/image.naturalHeight;mapAspectLoading=false;render()};image.onerror=()=>{mapAspectLoading=false};image.src=state.map.background}
  if(venueMode){const used=new Set();state.tables.filter(t=>Number.isFinite(t.mapX)&&Number.isFinite(t.mapY)).forEach((t,i)=>{const point=`${Math.round(t.mapX)}-${Math.round(t.mapY)}`;if(used.has(point)){t.mapX=17+(i%4)*22;t.mapY=18+(Math.floor(i/4)%4)*22}used.add(`${Math.round(t.mapX)}-${Math.round(t.mapY)}`)})}
  const displayed=venueMode?state.tables.filter(t=>Number.isFinite(t.mapX)&&Number.isFinite(t.mapY)):state.tables;
  board.innerHTML=venueView&&!state.map.background?'<div class="venue-start-message"><strong>最後一步：配置會場位置</strong>先完成列表排桌與座位圖，再上傳飯店場地圖。<br>桌次與賓客資料都會直接沿用。</div>':(venueMode&&!state.map.hidden?`<img class="venue-background-image" src="${state.map.background}" alt="飯店場地底圖">`:'')+displayed.map(t=>venueMode?renderVenueMarker(t):(seatMapMode?renderMapTable(t):renderListTable(t))).join('')+(venueMode&&!displayed.length?'<div class="venue-empty"><div><strong>尚未放置桌次</strong><br>請從上方「未放置桌次」選擇要放入的桌子。</div></div>':'');
  board.classList.toggle('venue-start',venueView&&!state.map.background);
  renderUnplacedTables(venueMode);
  bindDrags(); bindDrops();
  bindMapPositioning();
  document.querySelectorAll('[data-edit-table]').forEach(b=>b.onclick=()=>openTableDialog(b.dataset.editTable));
  document.querySelectorAll('[data-edit-member]').forEach(b=>b.onclick=()=>openPersonDialog(b.dataset.editMember));
  bindGroupDeleteButtons();
  document.querySelectorAll('[data-venue-marker]').forEach(m=>m.ondblclick=e=>{if(e.target.closest('button'))return;openSeatPreview(m.dataset.venueMarker)});
  board.onclick=e=>{if(!quickPlaceMode||!venueMode||e.target.closest('.venue-marker'))return;const t=state.tables.find(x=>!Number.isFinite(x.mapX)||!Number.isFinite(x.mapY));if(!t){quickPlaceMode=false;render();return toast('所有桌次都已放置')};const rect=board.getBoundingClientRect();t.mapX=Math.max(4,Math.min(96,(e.clientX-rect.left)/rect.width*100));t.mapY=Math.max(5,Math.min(95,(e.clientY-rect.top)/rect.height*100));if(!state.tables.some(x=>!Number.isFinite(x.mapX)||!Number.isFinite(x.mapY)))quickPlaceMode=false;render();toast(`已放置「${t.name}」`)};
}
function renderListTable(t){
    const count=tableCount(t.id), capClass=count>=t.hard?'full':count>t.comfort?'extra':'';
    const gs=state.groups.map(g=>({g,ms:g.members.filter(m=>m.tableId===t.id)})).filter(x=>x.ms.length);
    const categoryMap=new Map();gs.forEach(item=>{const c=categoryMap.get(item.g.category)||{name:item.g.category,groups:[],count:0};c.groups.push(item);c.count+=item.ms.length;categoryMap.set(item.g.category,c)});const categorySections=[...categoryMap.values()];
    return `<article class="table-card compact-table" data-table-id="${t.id}"><header class="table-header compact-header"><div class="table-identity"><div class="table-title">${esc(t.name)}</div><div class="capacity-note ${capClass}">舒適 ${t.comfort} · 上限 ${t.hard}</div></div><div class="seat-count ${capClass}"><strong>${count}</strong><span>人</span>${count>t.comfort?`<em>加位 ${count-t.comfort}</em>`:''}</div><div class="table-tools"><button class="table-settings-button" data-edit-table="${t.id}" title="設定桌名與座位容量">⚙ 桌次設定</button></div></header>
      <div class="compact-body category-first-body">${categorySections.length?categorySections.map(c=>`<section class="category-block"><header class="category-block-header"><strong>${esc(c.name)}</strong><span>${c.count} 位 · ${c.groups.length} 個群組</span></header><div class="category-group-list">${c.groups.map(({g,ms})=>`<section class="compact-group" style="--group-color:${groupColor(g)}"><div class="compact-group-head" draggable="true" data-drag-seated-group="${g.id}" data-table="${t.id}"><span class="group-color-dot"></span><strong>${esc(g.name)}</strong><span class="compact-group-actions"><span>${ms.length} 位</span><button type="button" class="delete-group-button compact-delete-group" data-delete-group="${g.id}" title="刪除整個群組">刪除</button></span></div><div class="compact-people">${ms.map(m=>`<div class="person ${m.child?'has-child-seat':''}" draggable="true" data-drag-member="${m.id}" data-edit-member="${m.id}" title="拖曳移動；點一下編輯"><span>${esc(m.name)}</span>${m.child?'<b class="child-seat-badge">👶 嬰兒椅</b>':''}${m.veg?'<b class="veg-badge">🥬 素食</b>':''}</div>`).join('')}</div></section>`).join('')}</div></section>`).join(''):'<div class="drop-hint compact-drop">將群組或賓客拖到這裡</div>'}</div></article>`;
}
function renderMapTable(t,venueMode=false){
  const count=tableCount(t.id), seated=state.groups.flatMap(g=>g.members.filter(m=>m.tableId===t.id).map(m=>({m,g}))), capClass=count>=t.hard?'full':count>t.comfort?'extra':'';
  const visibleSeatCount=count>t.comfort?t.hard:t.comfort;
  const slots=Array.from({length:visibleSeatCount},(_,i)=>seated[i]||null);
  const categoryMap=new Map();
  seated.forEach(({g})=>{const current=categoryMap.get(g.category)||{name:g.category,count:0,groups:[]};current.count++;if(!current.groups.includes(g))current.groups.push(g);categoryMap.set(g.category,current)});
  const categories=[...categoryMap.values()];
  const chairs=slots.map((item,i)=>{const angle=(360/visibleSeatCount)*i-90, color=item?groupColor(item.g):'#e8ded5';return `<div class="chair-wrap" style="--angle:${angle}deg;--seat-color:${color}">${item?`<button class="map-chair occupied ${item.m.child?'baby-chair':''} ${item.m.veg?'veg-chair':''}" draggable="true" data-drag-member="${item.m.id}" data-edit-member="${item.m.id}" title="${esc(item.g.name)}｜${esc(item.m.name)}${item.m.child?'｜嬰兒椅':''}${item.m.veg?'｜素食':''}">${item.m.child||item.m.veg?`<span class="chair-flags">${item.m.child?'<span class="chair-icon" aria-label="嬰兒椅">👶</span>':''}${item.m.veg?'<span class="veg-chair-icon" aria-label="素食">🥬</span>':''}</span>`:''}<span class="chair-name">${esc(item.m.name)}</span></button>`:`<div class="map-chair empty" title="舒適座位空位"><span class="chair-icon">○</span><span class="chair-name">空位</span></div>`}</div>`}).join('');
  const addOn=t.hard-t.comfort;
  return `<article class="table-card seating-map-card" data-table-id="${t.id}" ${venueMode?`style="left:${t.mapX}%;top:${t.mapY}%"`:''}><div class="round-layout">${chairs}<div class="round-table"><button class="map-settings" data-edit-table="${t.id}">⚙ 設定</button><div class="map-table-name">${esc(t.name)}</div><div class="map-count ${capClass}"><strong>${count}</strong><span>／${t.comfort} 人</span></div><div class="map-limit">舒適 ${t.comfort} · 最多 ${t.hard}</div>${addOn>0&&count<=t.comfort?`<div class="map-extra-seat">＋${addOn} 可加位</div>`:''}<div class="map-legends ${categories.length>4?'many-categories':''}">${categories.map(c=>`<div class="map-legend category-summary" title="${esc(c.name)}，共 ${c.count} 位"><span class="category-dots">${c.groups.map(g=>`<i style="background:${groupColor(g)}"></i>`).join('')}</span><b>${esc(c.name)}</b><small>${c.count}</small></div>`).join('')}</div></div>${venueMode?'<button class="map-move-handle" type="button">↕ 移動桌子</button>':''}</div></article>`;
}
function renderVenueMarker(t){
  const count=tableCount(t.id), capClass=count>=t.hard?'full':count>t.comfort?'extra':'', childCount=members().filter(m=>m.tableId===t.id&&m.child).length;
  const seatedGroups=state.groups.filter(g=>g.members.some(m=>m.tableId===t.id));
  const categoryMap=new Map();seatedGroups.forEach(g=>{const seatedCount=g.members.filter(m=>m.tableId===t.id).length,current=categoryMap.get(g.category)||{name:g.category,count:0,groups:[]};current.count+=seatedCount;current.groups.push(g);categoryMap.set(g.category,current)});const categories=[...categoryMap.values()];
  return `<article class="table-card venue-marker ${capClass}" data-table-id="${t.id}" data-venue-marker="${t.id}" title="雙擊查看完整座位圖" style="left:${t.mapX}%;top:${t.mapY}%"><button class="venue-marker-settings" data-edit-table="${t.id}" title="桌次設定">⚙</button><div class="venue-marker-name">${esc(t.name)}</div><div class="venue-marker-count"><strong>${count}</strong><span>／${t.comfort}</span></div><div class="venue-marker-note">${count>t.comfort?`加位 ${count-t.comfort}`:`最多 ${t.hard}`}</div>${childCount?`<div class="venue-child">👶 ${childCount}</div>`:''}<div class="venue-category-list">${categories.map(c=>`<div class="venue-category-chip" title="${esc(c.name)}，${c.count} 位"><span class="venue-category-colors">${c.groups.map(g=>`<i style="background:${groupColor(g)}"></i>`).join('')}</span><b>${esc(c.name)}</b><small>${c.count}</small></div>`).join('')}</div><button class="map-move-handle" type="button">↕ 移動</button></article>`;
}
function renderUnplacedTables(venueMode){
  const list=$('#unplacedTables'), panel=$('#unplacedPanel');panel.style.display=state.view==='venue'?'flex':'none';
  if(!venueMode){$('#unplacedHint').textContent='上傳場地底圖後，可將桌次放到正確位置。';list.innerHTML='';return}
  const unplaced=state.tables.filter(t=>!Number.isFinite(t.mapX)||!Number.isFinite(t.mapY));$('#unplacedHint').textContent=unplaced.length?`共有 ${unplaced.length} 張桌尚未放置。`:'所有桌次都已放置。';
  list.innerHTML=unplaced.map(t=>`<button class="unplaced-table" data-place-table="${t.id}">＋ ${esc(t.name)}</button>`).join('');
  document.querySelectorAll('[data-place-table]').forEach(b=>b.onclick=()=>{const t=state.tables.find(x=>x.id===b.dataset.placeTable),placedCount=state.tables.filter(x=>Number.isFinite(x.mapX)&&Number.isFinite(x.mapY)).length;t.mapX=17+(placedCount%4)*22;t.mapY=18+(Math.floor(placedCount/4)%4)*22;render();toast(`已將「${t.name}」放到地圖，可拖曳調整位置`)})
}
function bindMapPositioning(){
  document.querySelectorAll('.map-move-handle').forEach(handle=>handle.onpointerdown=e=>{e.preventDefault();e.stopPropagation();const card=handle.closest('.table-card'),t=state.tables.find(x=>x.id===card.dataset.tableId),board=$('#tableBoard'),rect=board.getBoundingClientRect();
    const move=ev=>{t.mapX=Math.max(4,Math.min(96,(ev.clientX-rect.left)/rect.width*100));t.mapY=Math.max(5,Math.min(95,(ev.clientY-rect.top)/rect.height*100));card.style.left=`${t.mapX}%`;card.style.top=`${t.mapY}%`};
    const up=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);persist();toast(`已更新「${t.name}」的位置`)};document.addEventListener('pointermove',move);document.addEventListener('pointerup',up)
  })
}
function openSeatPreview(id){previewTableId=id;refreshSeatPreview();$('#seatPreviewDialog').showModal()}
function refreshSeatPreview(){const t=state.tables.find(x=>x.id===previewTableId);if(!t)return;$('#seatPreviewContent').innerHTML=renderMapTable(t);bindDrags();bindDrops();document.querySelectorAll('#seatPreviewContent [data-edit-table]').forEach(b=>b.onclick=()=>openTableDialog(b.dataset.editTable));document.querySelectorAll('#seatPreviewContent [data-edit-member]').forEach(b=>b.onclick=()=>openPersonDialog(b.dataset.editMember))}
function dragPayload(el){
  if(el.dataset.dragMember)return {type:'member',memberIds:[el.dataset.dragMember]};
  if(el.dataset.dragSeatedGroup){const g=state.groups.find(x=>x.id===el.dataset.dragSeatedGroup);return {type:'group',groupId:g.id,memberIds:g.members.filter(m=>m.tableId===el.dataset.table).map(m=>m.id)};}
  const g=state.groups.find(x=>x.id===el.dataset.dragGroup);return {type:'group',groupId:g.id,memberIds:groupUnassigned(g).map(m=>m.id)};
}
function bindDrags(){document.querySelectorAll('[draggable="true"]').forEach(el=>{el.ondragstart=e=>{const p=dragPayload(el);e.dataTransfer.setData('application/json',JSON.stringify(p));e.dataTransfer.effectAllowed='move';}})}
function bindDrops(){document.querySelectorAll('.table-card').forEach(card=>{
  card.ondragover=e=>{e.preventDefault();const t=state.tables.find(x=>x.id===card.dataset.tableId),count=tableCount(t.id);card.classList.add(count>=t.hard?'drop-full':count>=t.comfort?'drop-extra':'drop-comfort')};
  card.ondragleave=()=>card.classList.remove('drop-full','drop-extra','drop-comfort');
  card.ondrop=e=>{e.preventDefault();card.classList.remove('drop-full','drop-extra','drop-comfort');try{requestMove(JSON.parse(e.dataTransfer.getData('application/json')),card.dataset.tableId)}catch{toast('無法辨識拖曳內容')}};
})}
function requestMove(payload,tableId){
  const t=state.tables.find(x=>x.id===tableId), moving=payload.memberIds.map(id=>members().find(m=>m.id===id)).filter(Boolean).filter(m=>m.tableId!==tableId);
  if(!moving.length)return toast('這些賓客已經在此桌');
  const current=tableCount(tableId), hardRoom=Math.max(0,t.hard-current), comfortRoom=Math.max(0,t.comfort-current);
  if(!hardRoom)return toast(`${t.name} 已達絕對上限 ${t.hard} 人`);
  if(moving.length>comfortRoom || moving.length>hardRoom){
    pendingMove={payload:{...payload,memberIds:moving.map(m=>m.id)},tableId,hardRoom,comfortRoom};
    $('#splitMessage').textContent=`${t.name} 舒適座位還有 ${comfortRoom} 席，加位後最多還能安排 ${hardRoom} 席；目前拖曳 ${moving.length} 位。`;
    $('#splitCount').max=Math.min(hardRoom,moving.length); $('#splitCount').value=Math.min(comfortRoom||hardRoom,moving.length);
    $('#capacityOptions').innerHTML=(comfortRoom?[`<button type="button" class="capacity-option" data-count="${Math.min(comfortRoom,moving.length)}">安排 ${Math.min(comfortRoom,moving.length)} 位，維持舒適人數</button>`]:[]).concat(hardRoom>comfortRoom?[`<button type="button" class="capacity-option" data-count="${Math.min(hardRoom,moving.length)}">安排 ${Math.min(hardRoom,moving.length)} 位，使用加位</button>`]:[]).join('');
    document.querySelectorAll('[data-count]').forEach(b=>b.onclick=()=>$('#splitCount').value=b.dataset.count); $('#splitDialog').showModal(); return;
  }
  applyMove(moving.map(m=>m.id),tableId);
}
function applyMove(ids,tableId){
  const before=ids.map(id=>{const m=members().find(x=>x.id===id);return {id,tableId:m.tableId}}), t=state.tables.find(x=>x.id===tableId);
  ids.forEach(id=>{const m=members().find(x=>x.id===id);m.tableId=tableId}); lastUndo=()=>{before.forEach(x=>members().find(m=>m.id===x.id).tableId=x.tableId);render()};
  render();if($('#seatPreviewDialog').open)refreshSeatPreview();toast(tableId?`已將 ${ids.length} 位移至「${t.name}」`:`已將 ${ids.length} 位移回待分配`,true);
}
function toast(msg,undo=false){const el=$('#toast');el.innerHTML=esc(msg)+(undo?'　<button id="undoToast" class="text-button" style="color:#ffd9d7">復原</button>':'');el.classList.add('show');if(undo)$('#undoToast').onclick=()=>{lastUndo?.();el.classList.remove('show')};clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),4200)}

function openTableDialog(id=null){editingTableId=id;const t=id?state.tables.find(x=>x.id===id):{name:`第 ${state.tables.length+1} 桌`,comfort:10,hard:11};$('#tableDialogTitle').textContent=id?'桌次設定':'新增桌次';$('#tableName').value=t.name;$('#comfortLimit').value=t.comfort;$('#hardLimit').value=t.hard;$('#deleteTableBtn').style.display=id?'block':'none';$('#tableDialog').showModal()}
$('#saveTableBtn').onclick=()=>{const name=$('#tableName').value.trim(),comfort=Number($('#comfortLimit').value),hard=Number($('#hardLimit').value);if(!name||comfort<1||hard<comfort)return toast('請確認桌名，且絕對上限不可小於舒適人數');if(editingTableId){Object.assign(state.tables.find(t=>t.id===editingTableId),{name,comfort,hard})}else state.tables.push({id:uid(),name,comfort,hard});$('#tableDialog').close();render()};
$('#addTableBtn').onclick=()=>openTableDialog();
$('#deleteTableBtn').onclick=()=>{if(state.tables.length===1)return toast('至少要保留一桌');const t=state.tables.find(x=>x.id===editingTableId);if(confirm(`確定刪除「${t.name}」？桌內賓客會移回待分配。`)){members().filter(m=>m.tableId===t.id).forEach(m=>m.tableId=null);state.tables=state.tables.filter(x=>x.id!==t.id);$('#tableDialog').close();render();toast('桌次已刪除')}};

function openPersonDialog(id){editingMemberId=id;const m=members().find(x=>x.id===id);$('#personName').value=m.name;$('#personChild').checked=m.child;$('#personVeg').checked=m.veg;$('#personDialog').showModal()}
$('#savePersonBtn').onclick=()=>{const m=members().find(x=>x.id===editingMemberId),name=$('#personName').value.trim();if(!name)return toast('姓名不可空白');Object.assign(m,{name,child:$('#personChild').checked,veg:$('#personVeg').checked});$('#personDialog').close();render();toast('賓客資料已更新')};
$('#returnWaitingBtn').onclick=()=>{$('#personDialog').close();applyMove([editingMemberId],null)};

function parseWorkbook(file){const reader=new FileReader();reader.onload=()=>{try{const wb=XLSX.read(reader.result,{type:'array'}),ws=wb.Sheets[wb.SheetNames[0]],raw=XLSX.utils.sheet_to_json(ws,{defval:''});importRows=raw.map(r=>({category:r['分類'],name:r['誰'],count:Number(r['人數']),note:r['備註'],child:r['兒童座椅'],veg:r['素食幾份'],cnCake:r['中式喜餅數量'],westCake:r['西式喜餅數量']})).filter(r=>r.name&&r.count>0);renderImportPreview(raw.length)}catch(e){toast('Excel 無法讀取，請確認欄位與檔案格式')}};reader.readAsArrayBuffer(file)}
function renderImportPreview(rawCount){$('#confirmImportBtn').disabled=!importRows.length;$('#importPreview').classList.remove('empty');$('#importPreview').innerHTML=`<table class="preview-table"><thead><tr><th>分類</th><th>群組</th><th>人數</th><th>兒童椅</th><th>素食</th></tr></thead><tbody>${importRows.slice(0,12).map(r=>`<tr><td>${esc(r.category)}</td><td>${esc(r.name)}</td><td>${r.count}</td><td>${Number(r.child)||0}</td><td>${Number(r.veg)||0}</td></tr>`).join('')}</tbody></table><p style="padding:10px;font-size:12px;color:#786a67">可匯入 ${importRows.length} 列；已略過 ${rawCount-importRows.length} 列。</p>`}
$('#excelInput').onchange=e=>e.target.files[0]&&parseWorkbook(e.target.files[0]);
$('#openImportBtn').onclick=()=>$('#importDialog').showModal();
$('#confirmImportBtn').onclick=()=>{state.groups.push(...importRows.map(makeGroup));const n=importRows.length;importRows=[];$('#excelInput').value='';$('#importPreview').className='import-preview empty';$('#importPreview').textContent='尚未選擇檔案';$('#confirmImportBtn').disabled=true;$('#importDialog').close();render();toast(`已匯入 ${n} 個群組`)};
const dz=$('#dropzone');dz.ondragover=e=>e.preventDefault();dz.ondrop=e=>{e.preventDefault();e.dataTransfer.files[0]&&parseWorkbook(e.dataTransfer.files[0])};

$('#manualBtn').onclick=()=>$('#manualDialog').showModal();
$('#saveManualBtn').onclick=()=>{const name=$('#manualName').value.trim(),count=Number($('#manualCount').value);if(!name||count<1)return toast('請填寫群組名稱與人數');state.groups.push(makeGroup({category:$('#manualCategory').value,name,count,note:$('#manualNote').value}));$('#manualDialog').close();['#manualCategory','#manualName','#manualNote'].forEach(s=>$(s).value='');$('#manualCount').value=1;render()};
$('#confirmSplitBtn').onclick=()=>{const count=Number($('#splitCount').value),max=Math.min(pendingMove.hardRoom,pendingMove.payload.memberIds.length);if(count<1||count>max)return toast(`安排人數需介於 1 到 ${max}`);$('#splitDialog').close();applyMove(pendingMove.payload.memberIds.slice(0,count),pendingMove.tableId);pendingMove=null};
$('#searchInput').oninput=renderWaiting;$('#categoryFilter').onchange=renderWaiting;
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;if(state.view!=='venue')quickPlaceMode=false;document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));render()});
$('#venueImageInput').onchange=e=>{const file=e.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>{const max=1800,scale=Math.min(1,max/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);state.map=state.map||{};state.map.background=canvas.toDataURL('image/jpeg',.82);state.map.aspect=canvas.width/canvas.height;state.map.hidden=false;state.tables.forEach(t=>{delete t.mapX;delete t.mapY});render();toast('場地底圖已載入，請放置桌次')};img.onerror=()=>toast('圖片無法讀取');img.src=reader.result};reader.readAsDataURL(file);e.target.value=''};
$('#toggleBackgroundBtn').onclick=()=>{state.map.hidden=!state.map.hidden;render()};
$('#quickPlaceBtn').onclick=()=>{if(!state.map.background)return toast('請先上傳場地底圖');if(!state.tables.some(t=>!Number.isFinite(t.mapX)||!Number.isFinite(t.mapY)))return toast('所有桌次都已放置');quickPlaceMode=!quickPlaceMode;render()};
$('#clearBackgroundBtn').onclick=()=>{if(confirm('確定移除場地底圖？桌次與賓客不會刪除，但桌子位置會重設。')){state.map.background=null;state.map.aspect=null;state.map.hidden=false;state.tables.forEach(t=>{delete t.mapX;delete t.mapY});render();toast('場地底圖已移除')}};
$('#closeSeatPreviewBtn').onclick=()=>$('#seatPreviewDialog').close();
$('#printBtn').onclick=()=>window.print();
$('#backupBtn').onclick=()=>download(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),'排桌備份.json');
$('#backupInput').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const x=JSON.parse(r.result);if(!x.groups||!x.tables)throw 0;state=x;render();toast('備份已讀取')}catch{toast('備份檔格式不正確')}};r.readAsText(f)};
const exportPalette=['FCE8E8','E8F1EC','EEE9F5','F8ECDF','E6EFF5','F2EDE4','F2E8EC','E7F2F1'];
function addExportStyles(xml){
  const fontCount=Number(xml.match(/<fonts count="(\d+)"/)?.[1]||1),fillCount=Number(xml.match(/<fills count="(\d+)"/)?.[1]||2),borderCount=Number(xml.match(/<borders count="(\d+)"/)?.[1]||1),xfCount=Number(xml.match(/<cellXfs count="(\d+)"/)?.[1]||1);
  const fills=[...exportPalette,'FFF2CC','FCE4D6','D9EAD3','A94F58'].map(color=>`<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`).join('');
  xml=xml.replace(/<fonts count="\d+">/,`<fonts count="${fontCount+1}">`).replace('</fonts>','<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft JhengHei"/></font></fonts>');
  xml=xml.replace(/<fills count="\d+">/,`<fills count="${fillCount+exportPalette.length+4}">`).replace('</fills>',fills+'</fills>');
  xml=xml.replace(/<borders count="\d+">/,`<borders count="${borderCount+1}">`).replace('</borders>',`<border><left/><right/><top style="thick"><color rgb="FFA94F58"/></top><bottom/><diagonal/></border></borders>`);
  const xfs=[...exportPalette.map((_,i)=>`<xf numFmtId="0" fontId="0" fillId="${fillCount+i}" borderId="0" xfId="0" applyFill="1"/>`),
    `<xf numFmtId="0" fontId="0" fillId="${fillCount+exportPalette.length}" borderId="0" xfId="0" applyFill="1"/>`,
    `<xf numFmtId="0" fontId="0" fillId="${fillCount+exportPalette.length+1}" borderId="0" xfId="0" applyFill="1"/>`,
    `<xf numFmtId="0" fontId="0" fillId="${fillCount+exportPalette.length+2}" borderId="0" xfId="0" applyFill="1"/>`,
    `<xf numFmtId="0" fontId="${fontCount}" fillId="${fillCount+exportPalette.length+3}" borderId="0" xfId="0" applyFont="1" applyFill="1"/>`,
    ...exportPalette.map((_,i)=>`<xf numFmtId="0" fontId="0" fillId="${fillCount+i}" borderId="${borderCount}" xfId="0" applyFill="1" applyBorder="1"/>`),
    `<xf numFmtId="0" fontId="0" fillId="${fillCount+exportPalette.length}" borderId="${borderCount}" xfId="0" applyFill="1" applyBorder="1"/>`].join('');
  xml=xml.replace(/<cellXfs count="\d+">/,`<cellXfs count="${xfCount+exportPalette.length*2+5}">`).replace('</cellXfs>',xfs+'</cellXfs>');
  return {xml,styleBase:xfCount,headerStyle:xfCount+exportPalette.length+3,groupStyleBase:xfCount+exportPalette.length+4};
}
function paintSheetRows(xml,rowStyles,headerStyle,headerRows=[1],freezeRows=1){
  xml=xml.replace(/<sheetView([^>]*)\/>/,`<sheetView$1><pane ySplit="${freezeRows}" topLeftCell="A${freezeRows+1}" activePane="bottomLeft" state="frozen"/></sheetView>`);
  return xml.replace(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g,(rowXml,rowNumber)=>{
    const style=headerRows.includes(Number(rowNumber))?headerStyle:rowStyles[Number(rowNumber)];
    return style===undefined?rowXml:rowXml.replace(/<c\b(?![^>]*\bs=")[^>]*>/g,cell=>cell.replace('<c ',`<c s="${style}" `));
  });
}
async function buildStyledExport(workbook,resultRowStyles,summaryRowStyles){
  const zip=await JSZip.loadAsync(XLSX.write(workbook,{bookType:'xlsx',type:'array'}));
  const styleFile=zip.file('xl/styles.xml'),styleResult=addExportStyles(await styleFile.async('string'));zip.file('xl/styles.xml',styleResult.xml);
  for(const [path,rowStyles,headerRows,freezeRows] of [['xl/worksheets/sheet1.xml',resultRowStyles,[1],1],['xl/worksheets/sheet2.xml',summaryRowStyles,[1,4],4]]){const file=zip.file(path);if(file){const resolvedStyles={};Object.entries(rowStyles).forEach(([row,style])=>resolvedStyles[row]=style&&typeof style==='object'?(style.group?styleResult.groupStyleBase:styleResult.styleBase)+style.palette:style);zip.file(path,paintSheetRows(await file.async('string'),resolvedStyles,styleResult.headerStyle,headerRows,freezeRows))}}
  return zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
$('#exportBtn').onclick=async()=>{
  if(!members().length)return toast('目前沒有賓客資料可匯出');
  const button=$('#exportBtn'),waitingCount=members().filter(m=>!m.tableId).length;button.disabled=true;button.textContent='整理中…';
  try{
    const headers=['桌次','分類','原始群組','姓名','兒童座椅','素食','備註','中式喜餅數量（群組合計）','西式喜餅數量（群組合計）'];
    const orderedSections=state.tables.map((table,index)=>({table,index,groups:state.groups.map(g=>({g,ms:g.members.filter(m=>m.tableId===table.id)})).filter(x=>x.ms.length)}));
    orderedSections.push({table:null,index:exportPalette.length,groups:state.groups.map(g=>({g,ms:g.members.filter(m=>!m.tableId)})).filter(x=>x.ms.length)});
    const data=[],resultRowStyles={},recordedGroupTotals=new Set();let excelRow=2;
    orderedSections.forEach(section=>section.groups.forEach(({g,ms})=>ms.sort((a,b)=>(a.originalIndex||0)-(b.originalIndex||0)).forEach((m,memberIndex)=>{const firstGroupTotalRow=!recordedGroupTotals.has(g.id);if(firstGroupTotalRow)recordedGroupTotals.add(g.id);data.push([section.table?.name||'待分配',g.category,g.name,m.name,m.child?'是':'',m.veg?'是':'',g.note,firstGroupTotalRow?(g.cnCake||''):'',firstGroupTotalRow?(g.westCake||''):'']);resultRowStyles[excelRow++]={palette:section.table?section.index%exportPalette.length:exportPalette.length,group:memberIndex===0}})));
    const resultSheet=XLSX.utils.aoa_to_sheet([headers,...data]);resultSheet['!autofilter']={ref:`A1:I${data.length+1}`};resultSheet['!cols']=[{wch:13},{wch:16},{wch:18},{wch:18},{wch:11},{wch:9},{wch:30},{wch:24},{wch:24}];resultSheet['!rows']=[{hpt:24}];
    const summaryHeaders=['桌次','已安排','舒適人數','絕對上限','使用加位','狀態'];
    const summaryData=state.tables.map(t=>{const count=tableCount(t.id),extra=Math.max(0,count-t.comfort);return [t.name,count,t.comfort,t.hard,extra,count>t.hard?'超過上限':extra?'使用加位':count===t.comfort?'剛好坐滿':'舒適']});
    summaryData.push(['待分配',waitingCount,'','','',waitingCount?'尚未完成':'已完成']);
    const assignedCount=members().length-waitingCount,totalComfort=state.tables.reduce((sum,t)=>sum+t.comfort,0),totalHard=state.tables.reduce((sum,t)=>sum+t.hard,0),totalExtra=state.tables.reduce((sum,t)=>sum+Math.max(0,tableCount(t.id)-t.comfort),0);
    const globalHeaders=['賓客總數','已安排','待安排','舒適座位','最大容量','已用加位'],globalValues=[members().length,assignedCount,waitingCount,totalComfort,totalHard,totalExtra];
    const summarySheet=XLSX.utils.aoa_to_sheet([globalHeaders,globalValues,[],summaryHeaders,...summaryData]);summarySheet['!autofilter']={ref:`A4:F${summaryData.length+4}`};summarySheet['!cols']=[{wch:14},{wch:13},{wch:13},{wch:13},{wch:13},{wch:14}];summarySheet['!rows']=[{hpt:24},{hpt:26},{hpt:9},{hpt:24}];
    const summaryRowStyles={2:{palette:1,group:false}};summaryData.forEach((row,i)=>{summaryRowStyles[i+5]={palette:row[0]==='待分配'?exportPalette.length:(row[5]==='使用加位'||row[5]==='超過上限'?exportPalette.length+1:exportPalette.length+2),group:false}});
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,resultSheet,'排桌結果');XLSX.utils.book_append_sheet(wb,summarySheet,'桌次統計');
    const blob=await buildStyledExport(wb,resultRowStyles,summaryRowStyles),date=new Date().toISOString().slice(0,10);download(blob,`婚宴排桌結果_${date}.xlsx`);toast(waitingCount?`已依桌次匯出；另有 ${waitingCount} 位待分配`:'已依桌次排序並匯出 Excel');
  }catch(error){console.error(error);toast('Excel 匯出失敗，請重新整理後再試一次')}
  finally{button.disabled=false;button.textContent='匯出 Excel'}
};
$('#clearBtn').onclick=()=>{if(confirm('確定清除所有賓客與排桌資料嗎？桌次設定會保留。')){state.groups=[];render();toast('已清除所有賓客')}};
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
render();
