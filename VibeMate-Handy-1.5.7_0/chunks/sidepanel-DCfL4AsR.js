import{s as v,a as b}from"./pageMessage-aGGF2Efh.js";import{l as I,d as s,m as p,n as S,b as N,o as E,s as L,k as M}from"./_virtual_wxt-plugins-Vf6cH492.js";import{s as r}from"./index-Ct4J2CFZ.js";class D{constructor(){this.noteMap={},this.currentTab=null,this.noteKey="",this.noteTimer=null,I(),this.initDom(),r.watch("local:noteMap",e=>{this.handleNoteMap(e)}),r.getItem("local:noteMap").then(e=>{this.handleNoteMap(e)}),s.tabs.onUpdated.addListener((e,t,n)=>{(t.url||t.title)&&this.handleChangeTab()}),s.tabs.onActivated.addListener(()=>{this.handleChangeTab()})}initDom(){let e=document.querySelector(".note-container");return e||(e=document.createElement("div"),e.className="note-container",e.innerHTML=`
      <div class="note-container-warp">
        <div class="note-header">
          <span class="logo"></span>
          <span class="title"></span>
        </div>
        <div class="note-content">
          <textarea
            class="note-input"
            placeholder="Input your stream note when you watch streaming, when you go to stream page, we will support more feature for you">
          </textarea>
        </div>
      </div>
      <div class="note-footer">
        <div class="how-to-use-btn">Check how to use</div>
      </div>
    `,document.body.appendChild(e),this.createGuideDom(),document.querySelector(".note-input")?.addEventListener("input",t=>{const{value:n}=t.target;this.noteTimer&&window.clearTimeout(this.noteTimer),this.noteTimer=window.setTimeout(()=>{this.updateNoteMap(this.noteKey,{noteText:n,noteTime:Date.now(),noteTitle:this.currentTab?.title,noteFavIconUrl:this.currentTab?.favIconUrl,noteUrl:this.currentTab?.url})},500)}),document.querySelector(".how-to-use-btn")?.addEventListener("click",()=>{try{p("SEND_BI_LOG",{eventId:"sidepanel",content:{position:"sidepanel",click_type:"lock_page",click_name:"back_use_tutorial"}})}catch{}const t=document.querySelector(".note-footer");t&&(t.style.display="none"),this.createGuideDom()}),e)}createGuideDom(){let e=document.querySelector(".guide-container")||null;if(e)return e;let t=S("/welcome.webp");e=document.createElement("div"),e.className="guide-container",e.innerHTML=`
      <div class="guide-anime">
        <div class="guide-anime-image">
          <img src="${t}" alt="fanberry-note-guide">
        </div>
      </div>
      <div class="guide-row">
        <div class="row-header">How to use</div>
        <div class="row-content-step">
          <div class="step">
            <span class="step-image step-image-1"></span>
            <span class="step-text">1. Choose a Livestream</span>
          </div>
          <div class="step">
            <span class="step-image step-image-2"></span>
            <span class="step-text">2. Enjoy Interactive Features!</span>
          </div>
        </div>
      </div>
      <div class="guide-row">
        <div class="row-header">What to Expect</div>
        <div class="row-content-item">
          <div class="item">
            <span class="item-icon"></span>
            <span class="item-text">Easily Engage with Your Favorite Streamers</span>
          </div>
          <div class="item">
            <span class="item-icon"></span>
            <span class="item-text">Enjoy Our Interactive Side Panel that Never Blocks Content</span>
          </div>
          <div class="item">
            <span class="item-icon"></span>
            <span class="item-text">Join Events and Earn Official Prizes!</span>
          </div>
        </div>
      </div>
      <div class="guide-action">
        <span class="try-it-now-btn">Try it Now</span>
      </div>
    `,document.querySelector(".note-content")?.appendChild(e),document.querySelector(".try-it-now-btn")?.addEventListener("click",()=>{if(e){try{p("SEND_BI_LOG",{eventId:"sidepanel",content:{position:"sidepanel",click_type:"lock_page",click_name:"try_it_now"}})}catch{}e.parentNode?.removeChild(e);const l=document.querySelector(".note-container-warp");l&&l.classList.remove("guide-warp");const c=document.querySelector(".note-input");c&&(c.style.display="block");const d=document.querySelector(".note-footer");d&&(d.style.display="block")}});const i=document.querySelector(".note-container-warp");i&&i.classList.add("guide-warp");const a=document.querySelector(".note-input");return a&&(a.style.display="none"),e}createHistoryDom(){let e=document.querySelector(".history-container")||null;return e||(e=document.createElement("div"),e.className="history-container",e.innerHTML=`
      <div class="back-action">
        <span class="back">⬅ Back</span>
      </div>
      <div class="history-list"></div>
    `,document.querySelector(".note-container")?.appendChild(e),document.querySelector(".back-action .back")?.addEventListener("click",()=>{e&&(e.style.display="none")}),e)}createHistoryListDom(){r.getItem("local:noteMap").then(e=>{const t=Object.values(e||{}).sort((i,a)=>a.noteTime-i.noteTime),n=document.querySelector(".history-list");if(n){n.innerHTML="",t.forEach(a=>{const l=document.createElement("div");l.className="history-item",l.innerHTML=`
            <div class="history-item-logo" style="background-image: url(${a.noteFavIconUrl})"></div>
            <div class="history-item-info">
              <div class="history-item-title">${a.noteTitle}</div>
              <div class="history-item-content">${a.noteText}</div>
              <div class="history-item-time">${new Date(a.noteTime).toLocaleString()}</div>
            </div>
          `,l.addEventListener("click",()=>{s.tabs.query({url:a.noteUrl}).then(c=>{if(c.length>0){const d=c[0];d.id&&s.tabs.update(d.id,{active:!0})}else s.tabs.create({url:a.noteUrl})})}),n.appendChild(l)});const i=this.createHistoryDom();i&&i.appendChild(n)}})}updateNoteDom(){const e=this.noteMap[this.noteKey]||null,t=document.querySelector(".logo"),n=document.querySelector(".title"),i=document.querySelector(".note-input");if(t){let a=e?.noteFavIconUrl||this.currentTab?.favIconUrl||"";t.style.backgroundImage=`url(${a})`}if(n){let a=e?.noteTitle||this.currentTab?.title||"";n.innerText=a,n.title=a}i&&(i.value=e?.noteText||"")}async updateNoteMap(e,t){try{if(!e)return;let n=this.noteMap[e]||{},i=t.noteText||n.noteText||"";i.length>1e3&&(i=i.slice(0,1e3));let a={noteText:i,noteTime:t.noteTime||n.noteTime||Date.now(),noteUrl:e,noteTitle:t.noteTitle||n.noteTitle||"",noteFavIconUrl:t.noteFavIconUrl||n.noteFavIconUrl||""};if(a.noteText){let l={...this.noteMap,[e]:a};await r.setItem("local:noteMap",l)}}catch{}}async initNoteFeature(){try{const e=await s.tabs.query({active:!0,currentWindow:!0});if(!e||!e[0])return;const{url:t="",title:n="",favIconUrl:i=""}=e[0];this.currentTab=e[0],this.noteKey=t,this.updateNoteMap(this.noteKey,{noteTitle:n,noteFavIconUrl:i,noteUrl:t}).finally(()=>{this.updateNoteDom()})}catch{}}handleChangeTab(){this.noteTimer&&window.clearTimeout(this.noteTimer);const e=document.querySelector(".note-input");this.updateNoteMap(this.noteKey,{noteText:e?.value,noteTime:Date.now()}).finally(()=>{this.initNoteFeature()})}handleNoteMap(e){e?this.noteMap=e:this.noteMap={}}}let y=!1,h=0,m=null,u=null;const w=()=>{let o=document.getElementById("web-sidepanel");o||(o=document.createElement("iframe"),o.id="web-sidepanel",o.width="100%",o.height="100%",o.frameBorder="0",o.allow="bluetooth; hid; serial; clipboard-read; clipboard-write;",o.className="sidepanel",document.body.appendChild(o));let e=M("sidepanel");o&&o.setAttribute("src",`${e}?t=${new Date().getTime()}`),m&&window.clearTimeout(m),m=window.setTimeout(()=>{h+=1,!y&&h<30&&w()},10*1e3)},g=()=>{const o=document.querySelector(".pre-loading");o&&o.remove()};window.addEventListener("message",o=>{const{uuid:e,...t}=o.data||{};if(e)return;const{type:n="",data:i=null}=t||{};n==="lvs-chrome-message-init"&&(y=!0,g(),r.setItem("local:isSidePanelIframeLoad",!0),v("EXTENSION_ID",s.runtime.id),N("SIDEPANEL_PAGE_LOADED",{status:!0}))});const k=(o,e)=>{const{type:t="",data:n=null}=o||{};t&&v(t,n)},U=async(o,e)=>{try{const{type:t="",data:n=null}=o||{};let i=null;return i=await b(t,n),i}catch(t){return t}},T=(o,e,t)=>{const{to:n="",isSync:i=!1}=o||{};if(["TO_SIDE_PANEL"].includes(n)&&!i&&k(o),["TO_SIDE_PANEL"].includes(n)&&i)return U(o).then(a=>{t(a)}).catch(a=>{t(a)}),!0},f=o=>{if(u&&u.disconnect(),o){const e=document.querySelector(".note-container");e&&e.remove(),u=s.runtime.connect({name:"SidePanel"}),w(),r.getItem("local:isShowNewUSerGuide").then(t=>{if(!t){r.setItem("local:isShowNewUSerGuide",!0);const n=`${E()}blog/new-user-guide`;window.open(n)}}),r.getItem("local:isNewUserReport").then(t=>{t||(r.setItem("local:isNewUserReport",!0),L("USER_REPORT_DATA",new Date().getTime()))})}else u=s.runtime.connect({name:"LockSidePanel"}),g(),new D().initNoteFeature()};s.runtime.onMessage.addListener(T);s.runtime.onMessageExternal.addListener(T);r.watch("local:isShowMoreFeature",f);r.getItem("local:isShowMoreFeature").then(f);
