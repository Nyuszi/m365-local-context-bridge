(function(){"use strict";const F={messageStableMs:1500},z=["https://m365.cloud.microsoft/*","https://copilot.microsoft.com/*"];function v(s){const t=[],e=i=>{if(i.nodeType===Node.TEXT_NODE){t.push(i.textContent??"");return}if(i instanceof Element){if(i.shadowRoot)for(const n of Array.from(i.shadowRoot.childNodes))e(n);for(const n of Array.from(i.childNodes))e(n)}};if(s instanceof Element&&s.shadowRoot)for(const i of Array.from(s.shadowRoot.childNodes))e(i);for(const i of Array.from(s.childNodes))e(i);return t.join("")}function C(s){const t=[s.getAttribute("data-code"),s.getAttribute("data-clipboard-text"),s.getAttribute("data-value"),s.querySelector("[data-clipboard-text]")?.getAttribute("data-clipboard-text"),s.querySelector("textarea")?.value];for(const n of t)if(n&&/LOCAL_TOOL_REQUEST|"protocolVersion"\s*:/.test(n))return n;const e=s.innerText||s.textContent||"";if(/LOCAL_TOOL_REQUEST/.test(e)||/"protocolVersion"\s*:\s*"1\.0"/.test(e))return e;const i=v(s);return i.length>e.length?i:e||i}function x(s){return s.replace(/\r\n/g,`
`).split(`
`).filter((t,e)=>{const i=t.trim();return!(e===0&&V(i)||/^\d+$/.test(i)||/^show more lines$/i.test(i)||/isn't fully supported/i.test(i)||/syntax highlighting is based on/i.test(i))}).join(`
`).replace(/^\n+/,"").replace(/\n+$/,"")}function V(s){return s?/^(plain\s*text|shell|bash|zsh|sh|kotlin|dart|json|typescript|javascript|java|python|csharp|c#|go|rust|sql|ruby|php|swift|scala|html|css|xml|yaml|yml|local-tool-request|local-tool-result)$/i.test(s)?!0:/^[{["0-9]/.test(s)?!1:!!(s.length<=24&&/^[A-Za-z][A-Za-z0-9+#.\s+-]*$/.test(s)&&!s.includes(":")):!1}function T(s){const t=[];function e(a){const o=a.getAttribute("data-lang");if(o)return o;const d=Array.from(a.classList).find(h=>h.startsWith("language-"));return d?d.slice(9):""}function i(a,o){return/"type"\s*:\s*"LOCAL_TOOL_REQUEST"/.test(a)?"local-tool-request":/"type"\s*:\s*"LOCAL_TOOL_RESULT"/.test(a)?"local-tool-result":o}function n(a){const o=a.trim();return o?/^local-tool-request$/i.test(o)?"local-tool-request":/^local-tool-result$/i.test(o)?"local-tool-result":o.toLowerCase().replace(/\s+/g,"-"):""}function r(a){const o=a.querySelector("#language-badge")?.textContent?.trim()||a.querySelector('[id*="language" i]')?.textContent?.trim()||"";let d=n(o);const h=x(C(a));d=i(h,d),t.push(`
\`\`\`${d}
${h}
\`\`\`
`)}function l(a){if(!(a instanceof Element))return!1;if(a.classList.contains("scriptor-component-code-block")||a.classList.contains("scriptor-codeblock-virtualized"))return!0;const o=typeof a.className=="string"?a.className:a.classList?.value||"";return o.includes("scriptor-component-code-block")||o.includes("scriptor-codeblock")}function c(a){if(a.nodeType===Node.TEXT_NODE){t.push(a.textContent??"");return}if(!(a instanceof Element))return;const o=a.tagName.toLowerCase();if(l(a)){r(a);return}if(o==="pre"){const d=a.querySelector("code")??a;let h=e(d);const u=C(d).replace(/\n+$/,"");h=i(u,h),t.push(`
\`\`\`${h}
${u}
\`\`\`
`);return}if(o==="br"){t.push(`
`);return}for(const d of Array.from(a.childNodes))c(d);(o==="p"||o==="div"||o==="li")&&t.push(`
`)}return c(s),t.join("").trim()}const Q=.6;function G(s,t){return s.computeConfidence(t)>=Q}function S(s,t){for(const e of t)try{const i=s.querySelector(e);if(i)return i}catch{}return null}function X(s){if(!(s instanceof HTMLElement))return!0;if(s.getClientRects().length===0)return!1;const t=s.ownerDocument.defaultView;if(!t)return!0;const e=t.getComputedStyle(s);return e.visibility!=="hidden"&&e.display!=="none"&&e.opacity!=="0"}function b(s,t){for(const e of t)try{const i=s.querySelectorAll(e);for(const n of Array.from(i))if(X(n))return n}catch{}return S(s,t)}function J(s,t){if(t.length===0)return 0;let e=0;for(const i of t)S(s,i)!==null&&(e+=1);return e/t.length}function E(s){const t=s.trim();return t.length<8||t.length>128||/^(new|home|chat|conversation|conversations|thread|threads|index)$/i.test(t)?!1:/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)?!0:/[0-9a-f]{8,}/i.test(t)||t.length>=16&&/[a-z0-9_-]+/i.test(t)}function K(s){try{const t=new URL(s),e=[t.searchParams.get("conversationId"),t.searchParams.get("threadId"),t.searchParams.get("chatId"),t.hash.match(/(?:conversationId|threadId|chatId)=([^&]+)/i)?.[1]??null];for(const n of e){const r=n?.trim();if(r&&E(r))return r}const i=t.pathname.split("/").filter(Boolean);if(i.length>=3&&/^chat$/i.test(i[0])&&/^conversation$/i.test(i[1])){const n=decodeURIComponent(i[2]);if(E(n))return n}if(i.length>=2&&/^chat$/i.test(i[0])){const n=decodeURIComponent(i[1]);if(E(n))return n}}catch{}return null}class m{id="copilot";displayName="Microsoft 365 Copilot Chat";static MESSAGE_CONTAINER_SELECTORS=['[data-testid="MessageListContainer"]',".fai-CopilotChat",'[data-testid="chat-messages"]','[data-testid*="message-list" i]','[role="feed"].fai-CopilotChat','[role="log"]','[role="feed"]','main [role="region"][aria-label*="chat" i]','main [role="region"][aria-label*="conversation" i]','[aria-label*="Chat messages" i]',"main"];static ASSISTANT_MESSAGE_SELECTORS=[".fai-CopilotMessage",'[data-testid="copilot-message-div"]','[data-testid="copilot-message-reply-div"]','[data-testid="markdown-reply"]','[data-testid="chatOutput"]','[data-message-author-role="assistant"]','[data-author="assistant"]','[data-content="ai-message"]','[data-content="assistant"]','[data-testid*="assistant" i]','[data-testid*="response-message" i]','[aria-label*="Copilot said" i]',".assistant-message",".ac-textBlock",'[class*="ai-message" i]'];static COMPOSER_SELECTORS=["#m365-chat-editor-target-element",'[data-lexical-editor="true"]','[aria-label="Message Copilot"]','[data-placeholder="Message Copilot"]',".fai-EditorInput__input","textarea#userInput","#userInput",'textarea[data-testid="composer-input"]','textarea[data-testid*="composer" i]','textarea[aria-label*="Ask" i]','textarea[aria-label*="Message" i]','textarea[aria-label*="Copilot" i]','textarea[placeholder*="Message" i]','textarea[placeholder*="Ask" i]','textarea[placeholder*="Copilot" i]','[contenteditable="true"][role="textbox"]','[role="textbox"][contenteditable="true"]','div[contenteditable="true"][aria-label*="Ask" i]','div[contenteditable="true"][aria-label*="Message" i]','div.ProseMirror[contenteditable="true"]'];static SEND_BUTTON_SELECTORS=['button[aria-label="Send"]',"button.fai-SendButton",".fai-SendButton",'button[aria-label*="Send" i]','button[aria-label*="Submit" i]','button[data-testid*="send" i]','button[data-testid*="submit" i]'];matchesUrl(t){return z.some(e=>{const i=e.replace("https://","").replace("/*","");try{return new URL(t).hostname===i}catch{return!1}})}computeConfidence(t){let e=0;return this.getComposer(t)&&(e+=.5),b(t,m.SEND_BUTTON_SELECTORS)&&(e+=.25),this.getMessageContainer(t)&&(e+=.15),b(t,m.ASSISTANT_MESSAGE_SELECTORS)&&(e+=.1),e}getMessageContainer(t){return S(t,['[data-testid="MessageListContainer"]',".fai-CopilotChat",'[data-testid="chat-messages"]','[data-testid*="message-list" i]'])??S(t,m.MESSAGE_CONTAINER_SELECTORS)}getAssistantMessageElements(t){const e=Array.from(t.querySelectorAll(".fai-CopilotMessage"));if(e.length>0)return e;const i=m.ASSISTANT_MESSAGE_SELECTORS.join(", "),n=Array.from(t.querySelectorAll(i));return n.filter(r=>!n.some(l=>l!==r&&l.contains(r)))}getMessageText(t){const e=t.querySelector(".fai-CopilotMessage__content")??t.querySelector('[data-testid="markdown-reply"]')??t.querySelector('[data-testid="copilot-message-reply-div"]')??t,i=T(e);if(/"type"\s*:\s*"LOCAL_TOOL_REQUEST"/.test(i))return i;const n=T(t);return/"type"\s*:\s*"LOCAL_TOOL_REQUEST"/.test(n)?n:i.length>=n.length?i:n}isMessageStreaming(t){return t.getAttribute("aria-busy")==="true"||t.querySelector('[data-testid="loading-message"]')?!0:t.classList.contains("streaming")||t.classList.contains("is-typing")}getComposer(t){return b(t,m.COMPOSER_SELECTORS)}setComposerText(t,e){if(t instanceof HTMLTextAreaElement||t instanceof HTMLInputElement){t.focus(),t.value=e,t.dispatchEvent(new Event("input",{bubbles:!0})),t.dispatchEvent(new Event("change",{bubbles:!0}));return}const i=t.ownerDocument;t.focus();try{const n=i.getSelection(),r=i.createRange();r.selectNodeContents(t),n?.removeAllRanges(),n?.addRange(r),i.execCommand("delete",!1),i.execCommand("insertText",!1,e)||this.pasteIntoComposer(t,e)}catch{this.pasteIntoComposer(t,e)}t.dispatchEvent(new InputEvent("input",{bubbles:!0,inputType:"insertText",data:e}))}pasteIntoComposer(t,e){try{const i=new DataTransfer;i.setData("text/plain",e);const n=new ClipboardEvent("paste",{bubbles:!0,cancelable:!0,clipboardData:i});(!t.dispatchEvent(n)||!(t.textContent||"").includes(e.slice(0,24)))&&(t.textContent=e)}catch{t.textContent=e}}isSendEnabled(t){return!(t.getAttribute("aria-disabled")==="true"||t.disabled||t.hasAttribute("disabled"))}submit(t,e){const i=b(t,m.SEND_BUTTON_SELECTORS);return i&&this.isSendEnabled(i)?(i.click(),!0):(e.focus(),e.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:!0,cancelable:!0})),e.dispatchEvent(new KeyboardEvent("keyup",{key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:!0,cancelable:!0})),!!i)}async insertAndSubmit(t,e){const i=t.ownerDocument;let n=this.getComposer(i)??t;n.focus(),this.setComposerText(n,e),await new Promise(c=>setTimeout(c,400));let r=!1;for(let c=0;c<30;c+=1){n=this.getComposer(i)??n;const a=b(i,m.SEND_BUTTON_SELECTORS);if(a&&(this.isSendEnabled(a)||c>=12)){r||(n.focus(),a.click(),r=!0),await new Promise(d=>setTimeout(d,200));const o=(n.textContent||"").trim();if(!o||o.length<Math.min(40,e.length/4))return!0;c===18&&r&&(r=!1);continue}await new Promise(o=>setTimeout(o,120))}if(!r)return this.submit(i,this.getComposer(i)??n);const l=((this.getComposer(i)??n).textContent||"").trim();return!l||l.length<Math.min(40,e.length/4)}getConversationId(t){const e=[t.location.href];try{const r=t.defaultView?.top?.location?.href;r&&r!==t.location.href&&e.push(r)}catch{}for(const r of e){const l=K(r);if(l)return l}const i=t.querySelector("[data-conversation-id], [data-thread-id], [data-chat-id]"),n=i?.getAttribute("data-conversation-id")||i?.getAttribute("data-thread-id")||i?.getAttribute("data-chat-id");return n?.trim()&&E(n.trim())?n.trim():null}setConversationTitle(t,e){const i=e.trim().slice(0,120);if(!i)return!1;const n=b(t,['button[aria-label*="Rename" i]','button[title*="Rename" i]','[data-testid*="rename" i]','button[aria-label*="Edit chat" i]','button[aria-label*="Edit title" i]']);n&&n.click();const r=b(t,['input[aria-label*="title" i]','input[aria-label*="name" i]','input[placeholder*="title" i]','input[placeholder*="name" i]','[role="dialog"] input[type="text"]','[role="dialog"] input:not([type])']);if(r)return r.focus(),r.value=i,r.dispatchEvent(new Event("input",{bubbles:!0})),r.dispatchEvent(new Event("change",{bubbles:!0})),b(t,['[role="dialog"] button[aria-label*="Save" i]','[role="dialog"] button[aria-label*="Rename" i]','[role="dialog"] button[type="submit"]'])?.click(),r.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:!0})),!0;const l=b(t,['h1[contenteditable="true"]','[data-testid*="conversation-title" i]','[aria-label*="conversation title" i]',"header h1","main h1"]);return l&&l.isContentEditable?(l.focus(),l.textContent=i,l.dispatchEvent(new Event("input",{bubbles:!0})),!0):!1}}class Y{id="mock-chat";displayName="Mock Chat";matchesUrl(t){try{return new URL(t).pathname.startsWith("/mock-chat")}catch{return!1}}computeConfidence(t){return J(t,[["#messages"],["#composer"],["#send-btn"],["#conversation-id"]])}getMessageContainer(t){return t.getElementById("messages")}getAssistantMessageElements(t){return Array.from(t.querySelectorAll('.msg[data-role="assistant"]'))}getMessageText(t){const e=t.querySelector(".msg-content");return T(e??t)}isMessageStreaming(t){return t.getAttribute("data-status")==="streaming"}getComposer(t){return t.getElementById("composer")}setComposerText(t,e){const i=t;i.value=e,i.dispatchEvent(new Event("input",{bubbles:!0}))}submit(t,e){const i=t.getElementById("send-btn");return i instanceof HTMLElement?(i.click(),!0):!1}getConversationId(t){return t.getElementById("conversation-id")?.dataset.conversationId??null}}const Z=[new Y,new m];function tt(s){return Z.find(t=>t.matchesUrl(s))??null}const M="1.0",et="local-tool-request",it="local-tool-result",nt=["project_info","list_files","find_files","directory_summary","search_text","read_file"];function st(s){return s.replace(/\r\n/g,`
`).split(`
`).filter((t,e)=>{const i=t.trim();return!(e===0&&(/^(plain\s*text|shell|bash|zsh|sh|kotlin|dart|json|typescript|javascript|java|python|csharp|c#|go|rust|sql|ruby|php|swift|scala|html|css|xml|yaml|yml|local-tool-request|local-tool-result)$/i.test(i)||i.length<=24&&/^[A-Za-z][A-Za-z0-9+#.\s+-]*$/.test(i)&&!i.includes(":")&&!/^[{["0-9]/.test(i))||/^\d+$/.test(i)||/^show more lines$/i.test(i)||/isn't fully supported/i.test(i)||/syntax highlighting is based on/i.test(i))}).join(`
`).replace(/^\n+/,"").replace(/\n+$/,"")}const rt=32768,N=["protocolVersion","type","id","tool","arguments"],ot=new Set(N);function at(s){const t=s.split(/\r\n|\r|\n/),e=[],i=/^(`{3,})\s*([^\s`]*)\s*$/;let n=0;for(;n<t.length;){const r=t[n]??"",l=i.exec(r);if(!l){n+=1;continue}const c=l[1]??"",a=(l[2]??"").trim(),o=new RegExp(`^\`{${c.length},}\\s*$`);let d=n+1;const h=[];let u=!1,H=!1;for(;d<t.length;){const I=t[d]??"";if(o.test(I)){u=!0;break}/^`{3,}/.test(I.trim())&&(H=!0),h.push(I),d+=1}u?(e.push({lang:a,content:h.join(`
`),hasNestedFence:H}),n=d+1):n+=1}return e}function lt(s){return new TextEncoder().encode(s).length}function W(s){return typeof s=="object"&&s!==null&&!Array.isArray(s)}function $(s){if(lt(s)>rt)return{reason:"oversized"};let t;try{t=JSON.parse(s)}catch{return{reason:"invalid-json"}}if(Array.isArray(t))return{reason:"batch-not-supported"};if(!W(t))return{reason:"invalid-field-type"};const e=Object.keys(t);for(const l of e)if(!ot.has(l))return{reason:"additional-properties"};for(const l of N)if(!(l in t))return{reason:"missing-field"};if(t.protocolVersion!==M)return{reason:"wrong-protocol-version"};if(t.type!=="LOCAL_TOOL_REQUEST")return{reason:"wrong-type"};const{id:i,tool:n,arguments:r}=t;return typeof i!="string"||i.length<1||i.length>128?{reason:"invalid-field-type"}:typeof n!="string"||!nt.includes(n)?{reason:"unknown-tool"}:W(r)?{request:{protocolVersion:M,type:"LOCAL_TOOL_REQUEST",id:i,tool:n,arguments:r}}:{reason:"invalid-field-type"}}function A(s){const e=at(s).filter(n=>n.lang===et);if(e.length>1)return{kind:"rejected",reason:"multiple-blocks",raw:s};if(e.length===1){const n=e[0];if(n.hasNestedFence)return{kind:"rejected",reason:"nested-fence",raw:n.content};const r=[n.content,st(n.content)];let l=null;for(const a of r){const o=$(a);if(!("reason"in o))return{kind:"request",request:o.request,raw:a};l={kind:"rejected",reason:o.reason,raw:a}}const c=_(n.content);if(c){const a=$(c);if(!("reason"in a))return{kind:"request",request:a.request,raw:c};l={kind:"rejected",reason:a.reason,raw:c}}return l??{kind:"rejected",reason:"invalid-json",raw:n.content}}const i=_(s);if(i){const n=$(i);return"reason"in n?{kind:"rejected",reason:n.reason,raw:i}:{kind:"request",request:n.request,raw:i}}return{kind:"none"}}function _(s){const t='"LOCAL_TOOL_REQUEST"';let e=s.indexOf(t);for(;e!==-1;){const i=s.lastIndexOf("{",e);if(i===-1){e=s.indexOf(t,e+t.length);continue}let n=0,r=!1,l=!1;for(let c=i;c<s.length;c+=1){const a=s[c];if(r){l?l=!1:a==="\\"?l=!0:a==='"'&&(r=!1);continue}if(a==='"'){r=!0;continue}if(a==="{")n+=1;else if(a==="}"&&(n-=1,n===0)){const o=s.slice(i,c+1);try{const d=JSON.parse(o);if(typeof d=="object"&&d!==null&&d.type==="LOCAL_TOOL_REQUEST")return o}catch{}break}}e=s.indexOf(t,e+t.length)}return null}const B="local-context-bridge-debug-root",ct=80,dt=`
:host { all: initial; }
.fab {
  position: fixed;
  left: 12px;
  bottom: 12px;
  z-index: 2147483646;
  font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  border: 1px solid #3a4a63;
  border-radius: 999px;
  padding: 7px 12px;
  cursor: pointer;
  color: #d7e6ff;
  background: rgba(12, 18, 28, 0.92);
  box-shadow: 0 6px 18px rgba(0,0,0,0.28);
}
.fab:hover { background: rgba(24, 35, 52, 0.96); }
.wrap {
  position: fixed;
  left: 12px;
  bottom: 12px;
  z-index: 2147483646;
  width: min(420px, calc(100vw - 24px));
  max-height: min(42vh, 360px);
  display: none;
  flex-direction: column;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #e8eef7;
  background: rgba(12, 18, 28, 0.94);
  border: 1px solid #3a4a63;
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(0,0,0,0.35);
  overflow: hidden;
}
.wrap.open { display: flex; }
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  background: #182334;
  border-bottom: 1px solid #314257;
  font-weight: 700;
  color: #9ec5ff;
}
.head button {
  font: inherit;
  border: 0;
  border-radius: 6px;
  padding: 3px 8px;
  cursor: pointer;
  background: #2a3b55;
  color: #e8eef7;
}
.lines {
  margin: 0;
  padding: 8px 10px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.line { margin: 0 0 4px; }
.line .t { color: #7f93b0; margin-right: 6px; }
.line.warn { color: #ffd28a; }
.line.error { color: #ff9b9b; }
.line.ok { color: #8dffb0; }
`;class ht{host;wrap;fab;linesEl;entries=[];visible=!1;enabled=!1;onVisibilityChange=null;constructor(t=document){this.host=t.getElementById(B)??t.createElement("div"),this.host.id=B,this.host.isConnected||t.documentElement.appendChild(this.host);const e=this.host.shadowRoot??this.host.attachShadow({mode:"open"});e.innerHTML="";const i=t.createElement("style");i.textContent=dt,e.appendChild(i),this.fab=t.createElement("button"),this.fab.type="button",this.fab.className="fab",this.fab.textContent="Dev logs",this.fab.title="Show Local Context Bridge developer logs",this.fab.addEventListener("click",()=>this.setVisible(!0,!0)),e.appendChild(this.fab),this.wrap=t.createElement("div"),this.wrap.className="wrap",this.wrap.innerHTML=`
      <div class="head">
        <span>LCB debug</span>
        <span>
          <button type="button" data-act="clear">Clear</button>
          <button type="button" data-act="hide">Hide</button>
        </span>
      </div>
      <div class="lines"></div>
    `,e.appendChild(this.wrap),this.linesEl=this.wrap.querySelector(".lines"),this.wrap.querySelector('[data-act="clear"]').addEventListener("click",()=>{this.entries.length=0,this.linesEl.innerHTML=""}),this.wrap.querySelector('[data-act="hide"]').addEventListener("click",()=>{this.setVisible(!1)}),this.applyVisibility()}setVisibilityListener(t){this.onVisibilityChange=t}setEnabled(t,e=!1){this.enabled=t,this.visible=t&&e,this.applyVisibility()}setVisible(t,e=!1){!this.enabled&&t&&(this.enabled=!0),this.visible=t,this.applyVisibility(),e&&this.onVisibilityChange?.(this.visible)}isVisible(){return this.enabled&&this.visible}applyVisibility(){if(!this.enabled){this.host.style.display="none";return}this.host.style.display="block",this.wrap.classList.toggle("open",this.visible),this.fab.style.display=this.visible?"none":"block"}log(t,e="info"){const i=new Date().toISOString().slice(11,19),n=document.createElement("div");for(n.className=`line ${e}`,n.innerHTML=`<span class="t">${i}</span>${ut(t)}`,this.entries.push(`[${i}] ${t}`),this.linesEl.appendChild(n);this.linesEl.childElementCount>ct;)this.linesEl.firstElementChild?.remove();this.linesEl.scrollTop=this.linesEl.scrollHeight,e==="error"&&console.error(`[LCB] ${t}`)}}function ut(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function pt(s,t,e){const i=new WeakMap,n=e.setTimeoutImpl??setTimeout,r=e.clearTimeoutImpl??clearTimeout;let l=null;function c(){l=null;const d=s.getAssistantMessageElements(t),h=d[d.length-1];if(!h)return;if(s.isMessageStreaming(h)){a();return}const u=s.getMessageText(h);i.get(h)!==u&&(i.set(h,u),e.onFinalMessage(u,h))}function a(){l!==null&&r(l),l=n(c,e.stableMs)}const o=new MutationObserver(()=>a());return o.observe(t,{childList:!0,subtree:!0,characterData:!0}),a(),{check:a,dispose:()=>{o.disconnect(),l!==null&&r(l)}}}const D="local-context-bridge-suggestion-root",ft=`
:host { all: initial; }
.panel {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 2147483647;
  width: 360px;
  max-width: calc(100vw - 40px);
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #0f1419;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}
.panel > * { pointer-events: auto; }
.card {
  background: #ffffff;
  border: 1px solid #d7dee7;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(15, 20, 25, 0.16);
  padding: 14px 16px;
}
.card h3 { margin: 0 0 6px; font-size: 14px; font-weight: 700; color: #0f1419; }
.card p { margin: 0 0 10px; color: #46525f; }
.card .note {
  margin: 0 0 12px;
  padding: 8px 10px;
  background: #f4f7fb;
  border-radius: 8px;
  color: #3a4654;
  font-size: 12px;
}
.card .note strong { color: #0f1419; }
.card code { background: #f0f3f7; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
button {
  font: inherit;
  border: 0;
  border-radius: 7px;
  padding: 7px 12px;
  cursor: pointer;
  font-weight: 600;
}
button.primary { background: #0d6e6a; color: #fff; }
button.primary:hover { background: #0a5855; }
button.secondary { background: #eef1f6; color: #0f1419; }
button.secondary:hover { background: #e2e7ef; }
button.link { background: transparent; color: #46525f; padding: 7px 4px; }
button.danger {
  background: transparent;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.45);
  padding: 10px 18px;
  font-size: 13px;
  letter-spacing: 0.04em;
}
button.danger:hover { background: rgba(255, 255, 255, 0.12); }
.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; background: #eef1f6; font-size: 11px; margin-left: 6px; }
.card pre {
  margin: 0 0 10px;
  max-height: 160px;
  overflow: auto;
  background: #f0f3f7;
  border-radius: 6px;
  padding: 8px;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  color: #0f1419;
}
.roots { margin: 0 0 10px; padding-left: 18px; color: #46525f; font-size: 12px; }
.roots li { margin: 0 0 4px; }
.error p { color: #9c2b2b; }

/* ---- Compact working card (chat stays visible) ---- */
.veil {
  position: fixed;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  z-index: 2147483646;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #fff;
  pointer-events: none;
  user-select: none;
  max-width: calc(100vw - 32px);
}
.veil.visible { display: flex; }
.working-box {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  width: min(340px, calc(100vw - 32px));
  padding: 18px 20px 16px;
  border-radius: 16px;
  background:
    radial-gradient(ellipse 120% 80% at 50% 0%, rgba(232, 93, 76, 0.35), transparent 55%),
    rgba(14, 24, 26, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.orbit {
  position: relative;
  width: 56px;
  height: 56px;
}
.orbit-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.15);
}
.orbit-ring.r2 { inset: 7px; border-color: rgba(43, 181, 174, 0.35); }
.orbit-ring.r3 { inset: 14px; border-color: rgba(240, 163, 90, 0.4); }
.orbit-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
  border-radius: 50%;
  background: #f0a35a;
  box-shadow: 0 0 10px rgba(240, 163, 90, 0.8);
  animation: orbit-spin 1.6s linear infinite;
}
.orbit-dot.d2 {
  background: #2bb5ae;
  box-shadow: 0 0 10px rgba(43, 181, 174, 0.8);
  animation: orbit-spin-inner 2.2s linear infinite reverse;
  width: 6px;
  height: 6px;
  margin: -3px 0 0 -3px;
}
.orbit-core {
  position: absolute;
  inset: 18px;
  border-radius: 50%;
  background: linear-gradient(145deg, #e85d4c, #f0a35a 55%, #2bb5ae);
  box-shadow: 0 0 18px rgba(232, 93, 76, 0.45);
  animation: core-pulse 1.4s ease-in-out infinite;
}
@keyframes orbit-spin {
  from { transform: rotate(0deg) translateX(22px); }
  to { transform: rotate(360deg) translateX(22px); }
}
@keyframes orbit-spin-inner {
  from { transform: rotate(0deg) translateX(14px); }
  to { transform: rotate(360deg) translateX(14px); }
}
@keyframes core-pulse {
  0%, 100% { transform: scale(1); filter: brightness(1); }
  50% { transform: scale(1.08); filter: brightness(1.15); }
}
.working-title {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-indent: 0.22em;
  line-height: 1;
}
.working-title .dot {
  display: inline-block;
  width: 0.28em;
  opacity: 0;
  animation: blink-dot 1.4s infinite;
}
.working-title .dot:nth-child(1) { animation-delay: 0s; }
.working-title .dot:nth-child(2) { animation-delay: 0.2s; }
.working-title .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink-dot {
  0%, 20% { opacity: 0; }
  30%, 70% { opacity: 1; }
  80%, 100% { opacity: 0; }
}
.working-detail {
  margin: 0;
  color: rgba(255, 255, 255, 0.82);
  font-size: 13px;
  line-height: 1.4;
  min-height: 1.4em;
}
.working-hint {
  margin: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}
`;class gt{host;shadow;panel;veil;workingDetail;cancelButton;blocking=!1;working=!1;onCancel=null;constructor(t=document){this.host=t.getElementById(D)??t.createElement("div"),this.host.id=D,this.host.isConnected||t.documentElement.appendChild(this.host),this.shadow=this.host.shadowRoot??this.host.attachShadow({mode:"open"}),this.shadow.innerHTML="";const e=t.createElement("style");e.textContent=ft,this.shadow.appendChild(e),this.veil=t.createElement("div"),this.veil.className="veil",this.veil.setAttribute("role","status"),this.veil.setAttribute("aria-live","polite"),this.veil.setAttribute("aria-label","Local Context Bridge working"),this.veil.innerHTML=`
      <div class="working-box">
        <div class="orbit" aria-hidden="true">
          <div class="orbit-ring"></div>
          <div class="orbit-ring r2"></div>
          <div class="orbit-ring r3"></div>
          <div class="orbit-core"></div>
          <div class="orbit-dot"></div>
          <div class="orbit-dot d2"></div>
        </div>
        <p class="working-title">WORKING<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span></p>
        <p class="working-detail"></p>
        <p class="working-hint">You can still read the chat — Cancel stops the bridge.</p>
        <button type="button" class="danger" data-cancel>Cancel</button>
      </div>
    `,this.workingDetail=this.veil.querySelector(".working-detail"),this.cancelButton=this.veil.querySelector("[data-cancel]"),this.cancelButton.addEventListener("click",()=>{const i=this.onCancel;this.clearWorking(),i?.()}),this.veil.addEventListener("keydown",i=>{i.key==="Escape"&&(i.preventDefault(),i.stopPropagation(),this.cancelButton.click())}),this.shadow.appendChild(this.veil),this.panel=t.createElement("div"),this.panel.className="panel",this.shadow.appendChild(this.panel)}clear(){this.blocking=!1,this.panel.innerHTML=""}isBlocking(){return this.blocking}isWorking(){return this.working}showWorking(t,e={}){this.working=!0,this.onCancel=e.onCancel??null,this.workingDetail.textContent=t||e.detail||"Local Context Bridge is working…",this.cancelButton.hidden=!this.onCancel,this.veil.classList.add("visible")}updateWorking(t){this.working&&(this.workingDetail.textContent=t)}clearWorking(){this.working=!1,this.onCancel=null,this.veil.classList.remove("visible")}unlockForComposer(){this.veil.classList.remove("visible")}relockWorking(){this.working&&this.veil.classList.add("visible")}showDetectionPrompt(t,e,i,n="ready"){this.clearWorking(),this.clear();const r=document.createElement("div");r.className="card";let l="Local Context Bridge",c="Let Copilot use read-only tools on your approved project folder?",a="Start";n==="needs-companion"?(c="Start Local Context Bridge on this Mac? The companion will launch, then the session can begin.",a="Start"):n==="needs-pairing"?(c="Connect this extension to the local companion, then start a session?",a="Start"):n==="needs-folder"&&(c="Approve a project folder, then start a read-only session with Copilot?",a="Start"),r.innerHTML=`
      <h3>${y(l)}</h3>
      <p>${y(c)}</p>
      <div class="note">
        <strong>Access is limited.</strong> The bridge only sees folders you explicitly
        approved (a project path, or optionally your home folder) — not the entire disk.
        Tools cannot write or delete files.
      </div>
      <div class="row"></div>
    `;const o=r.querySelector(".row");if(e.length>0&&n==="ready"){const d=document.createElement("ul");d.className="roots";for(const h of e){const u=document.createElement("li");u.innerHTML=`<code>${y(h.alias)}</code>${h.path?` — ${y(P(h.path))}`:""}${h.primary?" (primary)":""}`,d.appendChild(u)}r.insertBefore(d,o)}if(o.appendChild(f(a,"primary",()=>i.onStart(t))),e.length>1&&n==="ready"){const d=document.createElement("select");for(const h of e){const u=document.createElement("option");u.value=h.alias,u.textContent=h.path?`${h.alias} — ${P(h.path)}`:h.alias,h.alias===t&&(u.selected=!0),d.appendChild(u)}o.appendChild(d),o.appendChild(f("Use selected","secondary",()=>i.onStart(d.value)))}o.appendChild(f("Not now","link",i.onNotNow)),o.appendChild(f("Do not ask again","link",i.onNever)),this.panel.appendChild(r)}hideDetectionPrompt(){this.clear()}showPendingToolCall(t,e,i){this.clearWorking(),this.clear(),this.blocking=!0;const n=bt(t.arguments),r=document.createElement("div");r.className="card",r.innerHTML=`
      <h3>Allow local tool?<span class="badge">${y(t.tool)}</span></h3>
      <p>Copilot wants a <strong>read-only</strong> look inside <code>${y(e||"your project")}</code>.</p>
      <div class="note">Only the approved folder for this session is visible (project or home) — not the entire disk.</div>
      ${n?`<p><code>${y(n)}</code></p>`:""}
      <div class="row"></div>
    `;const l=r.querySelector(".row");l.appendChild(f("Run once","primary",()=>{this.blocking=!1,i.onRun()})),l.appendChild(f("Always allow","secondary",()=>{this.blocking=!1,i.onAlwaysAllow()})),l.appendChild(f("Decline","link",()=>{this.blocking=!1,i.onDecline()})),this.panel.appendChild(r)}showToolResultConfirmation(t,e){this.clearWorking(),this.clear(),this.blocking=!0;const i=document.createElement("div");i.className="card",i.innerHTML=`
      <h3>Result ready<span class="badge">${y(t.tool)}</span></h3>
      <p>${t.success?"The tool ran successfully.":"The tool call failed."} Insert the result into the composer and send it?</p>
      <div class="row"></div>
    `;const n=i.querySelector(".row");n.appendChild(f("Insert & send","primary",()=>{this.blocking=!1,e.onInsert()})),n.appendChild(f("Discard","secondary",()=>{this.blocking=!1,e.onDiscard()})),this.panel.appendChild(i)}showBootstrapManual(t){this.clearWorking(),this.clear();const e=document.createElement("div");e.className="card",e.innerHTML=`
      <h3>Paste bootstrap manually</h3>
      <p>Could not find the chat input on this page. Copy the message below, paste it into Copilot/mock chat, and send it.</p>
      <pre></pre>
      <div class="row"></div>
    `;const i=e.querySelector("pre");i.textContent=t;const n=e.querySelector(".row");n.appendChild(f("Copy message","primary",()=>{navigator.clipboard.writeText(t).then(()=>this.showTransientNotice("Bootstrap message copied — paste it into the chat and send."),()=>this.showTransientNotice("Copy failed — select the text in the panel and copy it yourself.","error"))})),n.appendChild(f("Dismiss","secondary",()=>this.clear())),this.panel.appendChild(e)}showSetupProgress(t,e){this.clear(),this.showWorking(t,{onCancel:e})}clearSetupProgress(){this.clearWorking(),this.blocking||this.clear()}showBootstrapSendFailed(t,e){this.clearWorking(),this.clear();const i=document.createElement("div");i.className="card",i.innerHTML=`
      <h3>Could not auto-send</h3>
      <p>The setup message may be in the composer. Click <strong>Send</strong> in Copilot, or retry.</p>
      <div class="row"></div>
    `;const n=i.querySelector(".row");n.appendChild(f("Retry send","primary",e.onRetry)),n.appendChild(f("Cancel","secondary",e.onCancel)),this.panel.appendChild(i)}showTransientNotice(t,e="info",i=6e3){if(this.blocking)return;this.clearWorking(),this.clear();const n=document.createElement("div");n.className=e==="error"?"card error":"card",n.innerHTML=`<p>${y(t)}</p>`,this.panel.appendChild(n),setTimeout(()=>{n.isConnected&&n.remove()},i)}dispose(){this.host.remove()}}function bt(s){if(Object.keys(s).length===0)return"";try{const e=JSON.stringify(s);return e.length>120?`${e.slice(0,117)}…`:e}catch{return""}}function P(s){const e=s.match(/^(\/Users\/[^/]+)/)?.[1];return e?s.replace(e,"~"):s.length>64?`…${s.slice(-60)}`:s}function f(s,t,e){const i=document.createElement("button");return i.className=t,i.textContent=s,i.addEventListener("click",e),i}function y(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function p(s){chrome.runtime.sendMessage(s).catch(()=>{})}function mt(s){return`\`\`\`${it}
${JSON.stringify(s,null,2)}
\`\`\``}function k(s){return new Promise(t=>setTimeout(t,s))}function yt(s,t=160){return s.replace(/\s+/g," ").trim().slice(0,t)}function w(s){return/LOCAL_TOOL_REQUEST/.test(s)?!0:/"protocolVersion"\s*:\s*"1\.0"/.test(s)&&/"tool"\s*:\s*"[a-z_]+"/.test(s)}function O(s){if(!s.trim())return{kind:"none"};const t=x(s);let e=A(t);if(e.kind==="request"||(e=A(s),e.kind==="request"))return e;if(!w(t)&&!w(s))return e.kind==="rejected"?e:{kind:"none"};const i=A("```local-tool-request\n"+t+"\n```");return i.kind==="request"?i:e.kind==="rejected"?e:i.kind==="rejected"?i:{kind:"none"}}function q(s){const t=x(s).trim();return t.includes("{")?/"tool"\s*:/.test(t)&&(/protocolVersion/.test(t)||/LOCAL_TOOL/.test(t)||/arguments/.test(t)):!1}const R=[".scriptor-component-code-block",".scriptor-codeblock-virtualized",'[class*="scriptor-component-code-block"]','[class*="scriptor-codeblock"]','[class*="CodeBlock"]','[class*="code-block"]',"pre","code"].join(", ");function g(s){if(!s)return"no";const t=s.getAttribute("data-testid");if(t)return t;const e=s.id;if(e)return`#${e}`;const n=(typeof s.className=="string"?s.className:"").split(/\s+/).find(r=>/copilot|message|chat|feed|list/i.test(r));return n?`.${n}`:s.tagName}async function j(s,t,e=40,i=300){for(let n=0;n<e;n+=1){const r=s.getComposer(t);if(r)return{container:s.getMessageContainer(t)??t.body,composer:r};await k(i)}return null}function L(s,t){return s.kind==="request"?s:t.kind==="request"?t:s.kind==="rejected"?s:t.kind==="rejected"?t:s}function wt(s,t,e){const i=s.getMessageText(t),n=t.innerText??"",r=v(t),l=t.querySelectorAll(R).length,c=w(i)||w(n)||w(r);e.log(`scan msg: len=${i.length} inner=${n.length} deep=${r.length} code=${l} hasLOCAL=${c}`);const a=(d,h)=>{const u=O(h);return u.kind==="none"||e.log(`parse via ${d} → ${u.kind}${u.kind==="rejected"?` (${u.reason})`:""}`,u.kind==="request"?"ok":"warn"),u};let o=a("reconstructed markdown",i);if(o.kind==="request"||(o=L(o,a("message innerText",n)),o.kind==="request")||r.length>0&&r!==n&&(o=L(o,a("deep shadow text",r)),o.kind==="request")||n.length>0&&n!==i&&(o=L(o,a("full-message reconstruct",T(t))),o.kind==="request"))return o;for(const d of Array.from(t.querySelectorAll(R))){const h=C(d);if(!(!w(h)&&!q(h))&&(o=L(o,a("code block",h)),o.kind==="request"))return o}return o.kind==="none"&&e.log(`parse=none preview="${yt(i||n||r)}"`),o}class kt{constructor(t){this.adapter=t}overlay=new gt(document);debug=new ht(document);watcher=null;composer=null;watchContainer=null;heartbeatTimer=null;chatPollTimer=null;lastChatId=null;awaitingChatLink=!1;chatLinkWaitTimer=null;historicalToolRequestIds=new Set;activeBootstrapConversationId=null;bootstrapInProgress=!1;init(){this.debug.log(`content script loaded adapter=${this.adapter.id} url=${location.href}`,"ok"),this.debug.setEnabled(!1),p({type:"cb/content-ready",url:location.href}),this.reportDetection(),this.startChatIdPolling(),this.startPendingStartPolling(),window.setTimeout(()=>this.reportDetection(),1500),window.setTimeout(()=>this.reportDetection(),4e3),chrome.runtime.onMessage.addListener(t=>{vt(t)&&(t.type!=="bc/debug"&&this.debug.log(`← ${t.type}`),this.handleBackgroundMessage(t))})}startPendingStartPolling(){const t=/[?&]lcb_start=/.test(location.href);let e=0;const i=t?30:15,n=()=>{e+=1,p({type:"cb/check-pending-start"}),!(e>=i)&&window.setTimeout(n,t?1e3:2e3)};window.setTimeout(n,t?300:800)}reportDetection(){const t=this.adapter.computeConfidence(document),e=this.adapter.getComposer(document),i=this.adapter.getMessageContainer(document),n=i?this.adapter.getAssistantMessageElements(i).length:0;this.debug.log(`detect conf=${t.toFixed(2)} composer=${g(e)} container=${g(i)} assistants=${n}`),p({type:"cb/adapter-detected",adapterId:this.adapter.id,confidence:t,url:location.href,hasComposer:e!==null}),this.watcher&&(this.ensureWatcherContainer(`detect(assistants=${n})`),n>0&&this.scanLatestAssistant("detect"))}handleBackgroundMessage(t){switch(t.type){case"bc/show-detection-prompt":if(this.awaitingChatLink||this.overlay.isBlocking())return;this.overlay.showDetectionPrompt(t.projectAlias,t.roots,{onStart:e=>{p({type:"cb/ensure-ready-and-start",projectAlias:e}),this.overlay.hideDetectionPrompt()},onNotNow:()=>{p({type:"cb/dismiss-prompt",kind:"not-now"}),this.overlay.hideDetectionPrompt()},onNever:()=>{p({type:"cb/dismiss-prompt",kind:"never"}),this.overlay.hideDetectionPrompt()}},t.readiness);return;case"bc/hide-detection-prompt":this.overlay.hideDetectionPrompt();return;case"bc/session-started":this.onSessionStarted(t.bootstrapMessage,t.projectAlias,t.chatTitle,t.conversationId);return;case"bc/session-resumed":this.onSessionResumed(t.projectAlias,t.mode);return;case"bc/pending-tool-call":this.debug.log(`pending tool ${t.request.tool} id=${t.request.id}`,"ok"),this.overlay.showPendingToolCall(t.request,t.projectAlias,{onRun:()=>{this.overlay.clear(),this.showWorkingOverlay(`Running ${t.request.tool}…`),this.debug.log(`user approved ${t.request.tool}`,"ok"),p({type:"cb/run-approved",requestId:t.request.id})},onAlwaysAllow:()=>{this.overlay.clear(),this.showWorkingOverlay(`Running ${t.request.tool}…`),this.debug.log(`user always-allow ${t.request.tool}`,"ok"),p({type:"cb/run-approved",requestId:t.request.id,enableAutomatic:!0})},onDecline:()=>{this.overlay.clear(),this.overlay.clearWorking(),p({type:"cb/run-declined",requestId:t.request.id})}});return;case"bc/tool-result-ready":this.debug.log(`tool result ${t.result.tool} success=${t.result.success}`,t.result.success?"ok":"error"),this.overlay.clear(),this.onToolResultReady(t.result,t.requiresConfirmation,t.autoSubmit);return;case"bc/tool-call-failed":if(this.overlay.clear(),this.overlay.clearWorking(),/replay|duplicate/i.test(t.message)){U(document,t.requestId)&&this.historicalToolRequestIds.add(t.requestId),this.debug.log(`companion duplicate/replay for id=${t.requestId} (will retry or ignore if result present)`,"warn");return}this.debug.log(`tool failed: ${t.message}`,"error"),this.overlay.showTransientNotice(`Tool call failed: ${t.message}`,"error");return;case"bc/session-stopped":this.debug.log(`session stopped (${t.reason})`,"warn"),this.awaitingChatLink=!1,this.chatLinkWaitTimer!==null&&(window.clearInterval(this.chatLinkWaitTimer),this.chatLinkWaitTimer=null),this.stopHeartbeatScans(),this.overlay.clearWorking(),this.overlay.clear(),this.overlay.showTransientNotice(t.reason==="user"?"Cancelled — Local Context Bridge stopped for this chat.":`Local Context Bridge session stopped (${t.reason}).`),this.watcher?.dispose(),this.watcher=null,this.watchContainer=null;return;case"bc/session-limit-warning":this.overlay.showTransientNotice(t.message);return;case"bc/debug":this.debug.log(t.message,t.level??"info");return;case"bc/settings":this.debug.setEnabled(t.showDeveloperLogs,t.showDeveloperLogs);return}}async onSessionResumed(t,e){this.debug.log(`session-resumed project=${t} mode=${e}`,"ok"),this.overlay.hideDetectionPrompt(),this.overlay.clearWorking(),this.overlay.clearSetupProgress(),this.awaitingChatLink=!1,this.chatLinkWaitTimer!==null&&(window.clearInterval(this.chatLinkWaitTimer),this.chatLinkWaitTimer=null),this.seedHistoricalToolRequests("resume");const i=await j(this.adapter,document);if(i)this.composer=i.composer,this.attachWatcher(i.container,"session-resume");else{const n=this.adapter.getMessageContainer(document)??document.body;this.attachWatcher(n,"session-resume-no-composer")}this.startHeartbeatScans(),this.checkChatId(),window.setTimeout(()=>this.scanLatestAssistant("after-resume"),800),this.overlay.showTransientNotice(`Session resumed (${t}). Local tools are available for this chat.`,"info",5e3)}seedHistoricalToolRequests(t){const e=Ct(document);for(const i of e)this.historicalToolRequestIds.add(i);this.debug.log(`${t}: ignoring ${e.length} historical tool request id(s) already in transcript`,"ok")}async onSessionStarted(t,e,i,n){if(this.bootstrapInProgress||n&&this.activeBootstrapConversationId===n){this.debug.log(`ignoring duplicate session-started${n?` for ${n}`:""}`,"warn");return}this.bootstrapInProgress=!0,n&&(this.activeBootstrapConversationId=n);try{this.debug.log(`session-started project=${e} bootstrapChars=${t.length}`),this.historicalToolRequestIds.clear();const r=await j(this.adapter,document);if(!r){if(this.overlay.clearWorking(),this.overlay.clearSetupProgress(),this.adapter.getComposer(document)===null&&this.adapter.computeConfidence(document)<.25){this.debug.log("no composer in this frame — ignoring (likely shell frame)","warn");return}this.debug.log("composer not found after wait — showing manual paste","error"),this.overlay.showBootstrapManual(t);return}this.debug.log(`composer ok id=${r.composer.id||r.composer.tagName} container=${g(r.container)}`,"ok"),this.composer=r.composer,this.overlay.clearWorking();let l=await this.pasteAndSend(r.composer,t,"bootstrap");if(l||(this.debug.log("bootstrap send failed — retrying once","warn"),await k(400),l=await this.pasteAndSend(r.composer,t,"bootstrap-retry")),this.debug.log(`bootstrap inserted+submit=${l}`,l?"ok":"warn"),i&&this.adapter.setConversationTitle&&window.setTimeout(()=>{this.adapter.setConversationTitle?.(document,i)},1200),this.attachWatcher(r.container,"session-start"),this.startHeartbeatScans(),!l){const c=()=>{(async()=>{this.overlay.clear();const a=this.adapter.getComposer(document)??r.composer,o=await this.pasteAndSend(a,t,"bootstrap-manual-retry");this.debug.log(`bootstrap manual retry submit=${o}`,o?"ok":"warn"),o?this.showWorkingOverlay("Setup sent — waiting for Copilot to open the chat link…"):(this.overlay.showBootstrapSendFailed(t,{onRetry:c,onCancel:()=>this.cancelWorking()}),this.overlay.showTransientNotice("Still could not click Send — press Send in Copilot yourself.","error",8e3))})()};this.overlay.showBootstrapSendFailed(t,{onRetry:c,onCancel:()=>this.cancelWorking()}),this.beginChatLinkWait();return}this.showWorkingOverlay("Setup sent — waiting for Copilot to open the chat link…"),this.beginChatLinkWait()}finally{this.bootstrapInProgress=!1}}async pasteAndSend(t,e,i){this.overlay.unlockForComposer(),this.overlay.clearWorking(),await k(60);const n=this.adapter.getComposer(document)??t;n.focus(),await k(80);let r=!1;this.adapter.insertAndSubmit?r=await this.adapter.insertAndSubmit(n,e):(this.adapter.setComposerText(n,e),await k(120),r=this.adapter.submit(document,n));const l=(n.textContent||"").trim().length;return this.debug.log(`pasteAndSend(${i}) submit=${r} leftoverChars=${l}`,r?"ok":"warn"),this.composer=this.adapter.getComposer(document)??n,r}showWorkingOverlay(t){this.overlay.showWorking(t,{onCancel:()=>this.cancelWorking()})}cancelWorking(){this.debug.log("user cancelled working overlay","warn"),this.awaitingChatLink=!1,this.chatLinkWaitTimer!==null&&(window.clearInterval(this.chatLinkWaitTimer),this.chatLinkWaitTimer=null),this.stopHeartbeatScans(),this.overlay.clearWorking(),this.overlay.clear(),p({type:"cb/cancel-working"})}beginChatLinkWait(){this.awaitingChatLink=!0,this.chatLinkWaitTimer!==null&&(window.clearInterval(this.chatLinkWaitTimer),this.chatLinkWaitTimer=null);const t=Date.now(),e=9e4;let i=0;const n=l=>{this.awaitingChatLink=!1,this.chatLinkWaitTimer!==null&&(window.clearInterval(this.chatLinkWaitTimer),this.chatLinkWaitTimer=null),this.overlay.isBlocking()||(this.overlay.clearWorking(),this.overlay.showTransientNotice(l?"Setup complete — chat link saved. You can resume this session from the Bridge app.":"Setup message was sent, but the chat link did not appear yet. Keep this tab open — it may still update.",l?"info":"error",6e3)),this.checkChatId()},r=()=>{i+=1,this.checkChatId();const l=this.adapter.getConversationId(document);if(l){this.debug.log(`chat link ready id=${l}`,"ok"),n(!0);return}const c=Date.now()-t;if(c>=e){this.debug.log("chat link wait timed out","warn"),n(!1);return}this.overlay.isBlocking()||this.overlay.isWorking()&&(i===1||i%4===0)&&this.overlay.updateWorking(`Waiting for Copilot chat link… (${Math.round(c/1e3)}s)`)};window.setTimeout(r,400),this.chatLinkWaitTimer=window.setInterval(r,750)}startHeartbeatScans(){this.heartbeatTimer!==null&&window.clearInterval(this.heartbeatTimer);let t=0;this.heartbeatTimer=window.setInterval(()=>{t+=1,!this.overlay.isBlocking()&&((t===1||t%4===0)&&this.ensureWatcherContainer(`hb:${t*3}s`),this.scanLatestAssistant(`heartbeat:${t*3}s`))},3e3)}stopHeartbeatScans(){this.heartbeatTimer!==null&&(window.clearInterval(this.heartbeatTimer),this.heartbeatTimer=null)}startChatIdPolling(){this.chatPollTimer!==null&&window.clearInterval(this.chatPollTimer),this.checkChatId(),this.chatPollTimer=window.setInterval(()=>this.checkChatId(),2e3)}checkChatId(){if(this.adapter.id!=="copilot")return;const t=this.adapter.getConversationId(document);if(!t||t===this.lastChatId)return;this.lastChatId=t;const e=document.title?.replace(/\s*[|–-]\s*Microsoft.*$/i,"").trim()||void 0;p({type:"cb/chat-changed",chatId:t,url:location.href,title:e}),this.debug.log(`chat-id → ${t}`,"ok")}attachWatcher(t,e){this.watchContainer=t,this.watcher?.dispose(),this.watcher=pt(this.adapter,t,{stableMs:F.messageStableMs,onFinalMessage:(i,n)=>this.onFinalAssistantMessage(i,n)}),this.debug.log(`watcher attached (${e}) → ${g(t)} assistants=${this.adapter.getAssistantMessageElements(t).length}`,"ok")}ensureWatcherContainer(t){const e=this.adapter.getMessageContainer(document);if(!e){this.debug.log(`ensureWatcher(${t}): still no MessageListContainer`,"warn");return}const i=e.getAttribute("data-testid")==="MessageListContainer"||e.classList.contains("fai-CopilotChat"),n=this.watchContainer?.getAttribute("data-testid")==="MessageListContainer"||this.watchContainer?.classList.contains("fai-CopilotChat");if(this.watchContainer===e){this.scanLatestAssistant(`ensure-same:${t}`);return}if(i&&!n){this.debug.log(`rebinding watcher (${t}): ${g(this.watchContainer)} → ${g(e)}`,"ok"),this.attachWatcher(e,`rebind:${t}`),this.scanLatestAssistant(`after-rebind:${t}`);return}this.watchContainer&&e.contains(this.watchContainer)&&e!==this.watchContainer&&(this.debug.log(`rebinding watcher to ancestor (${t}): ${g(this.watchContainer)} → ${g(e)}`,"ok"),this.attachWatcher(e,`ancestor:${t}`),this.scanLatestAssistant(`after-ancestor:${t}`))}handleParseOutcome(t){if(t.kind!=="none"){if(t.kind==="rejected"){this.debug.log(`rejected (ignored): ${t.reason}`);return}if(this.historicalToolRequestIds.has(t.request.id)){this.debug.log(`historical tool ignored id=${t.request.id}`);return}if(U(document,t.request.id)){this.historicalToolRequestIds.add(t.request.id),this.debug.log(`already-answered tool ignored id=${t.request.id}`);return}if(this.overlay.isBlocking()){this.debug.log(`already awaiting user action — skip re-notify for ${t.request.id}`);return}this.debug.log(`→ tool-request-detected ${t.request.tool} id=${t.request.id}`,"ok"),this.showWorkingOverlay(`Running ${t.request.tool}…`),p({type:"cb/tool-request-detected",request:t.request})}}scanLatestAssistant(t){if(this.overlay.isBlocking()){this.debug.log(`${t} scan skipped — waiting for Run/Decline`);return}const e=this.adapter.getMessageContainer(document)??this.watchContainer??document.body;this.watcher&&e!==this.watchContainer&&(e.getAttribute("data-testid")==="MessageListContainer"||e.classList.contains("fai-CopilotChat"))&&this.attachWatcher(e,`scan-promote:${t}`);const i=this.adapter.getAssistantMessageElements(e);if(this.debug.log(`${t} scan: container=${g(e)} assistants=${i.length}`),i.length===0)return;const n=Math.max(0,i.length-8);for(let r=i.length-1;r>=n;r-=1){const l=i[r];if(this.tryScanAssistantElement(l,t,r===i.length-1))return}}tryScanAssistantElement(t,e,i){const n=this.adapter.getMessageText(t)||t.textContent||"",r=wt(this.adapter,t,this.debug);if(r.kind==="request")return this.handleParseOutcome(r),!0;r.kind==="rejected"&&i&&this.handleParseOutcome(r);for(const l of Array.from(t.querySelectorAll(R))){const c=C(l);if(!w(c)&&!q(c))continue;const a=O(c);if(a.kind==="request")return this.debug.log(`${e} code block → request`,"ok"),this.handleParseOutcome(a),!0;if(q(c)){const o=O("```local-tool-request\n"+x(c.trim())+"\n```");if(o.kind==="request")return this.debug.log(`${e} plain JSON code block → request`,"ok"),this.handleParseOutcome(o),!0}}return i&&!w(n)&&!w(v(t))&&this.debug.log(`${e}: latest assistant has no tool request (ok if prose/options)`),!1}onFinalAssistantMessage(t,e){this.debug.log(`watcher settled len=${t.length} el=${g(e)}`),this.scanLatestAssistant("watcher-settled")}onToolResultReady(t,e,i){const n=mt(t);if(e){this.overlay.showToolResultConfirmation(t,{onInsert:()=>{this.showWorkingOverlay("Sending tool result to Copilot…"),this.insertResult(n,i,t.requestId)},onDiscard:()=>{this.overlay.clear(),this.overlay.clearWorking(),p({type:"cb/tool-insert-failed",requestId:t.requestId})}});return}this.showWorkingOverlay("Sending tool result to Copilot…"),this.insertResult(n,i,t.requestId)}insertResult(t,e,i){this.insertResultAsync(t,e,i)}async insertResultAsync(t,e,i){if((!this.composer||!G(this.adapter,document))&&(this.composer=this.adapter.getComposer(document)),!this.composer){this.debug.log("lost composer — cannot insert result","error"),i&&p({type:"cb/tool-insert-failed",requestId:i}),this.overlay.clearWorking(),this.overlay.showTransientNotice("Lost track of the chat composer; could not insert the tool result automatically.","error");return}if(e){this.overlay.unlockForComposer();let n=!1;this.adapter.insertAndSubmit?n=await this.adapter.insertAndSubmit(this.composer,t):(this.adapter.setComposerText(this.composer,t),await k(120),n=this.adapter.submit(document,this.composer)),this.debug.log(`result inserted submit=${n}`,n?"ok":"warn"),!n&&i?p({type:"cb/tool-insert-failed",requestId:i}):n&&i&&this.historicalToolRequestIds.add(i),this.overlay.clear(),this.overlay.clearWorking(),this.overlay.showTransientNotice(n?"Local tool result sent to Copilot.":"Result pasted — Send was not ready; click Send if needed.",n?"info":"error"),this.startHeartbeatScans(),window.setTimeout(()=>this.scanLatestAssistant("after-result"),1500),window.setTimeout(()=>this.scanLatestAssistant("after-result-2"),4e3)}else this.overlay.unlockForComposer(),this.adapter.setComposerText(this.composer,t),this.debug.log("result inserted (manual send)","ok"),this.overlay.clearWorking(),this.overlay.showTransientNotice("Result inserted into the composer — review and send it yourself.")}}function vt(s){return typeof s=="object"&&s!==null&&typeof s.type=="string"&&s.type.startsWith("bc/")}function Ct(s){const t=s.body,e=t?`${t.innerText??""}
${v(t)}`:"",i=new Set;for(const n of e.matchAll(/"requestId"\s*:\s*"([^"]{1,128})"/g))i.add(n[1]);for(const n of e.matchAll(/"type"\s*:\s*"LOCAL_TOOL_REQUEST"[\s\S]{0,400}?"id"\s*:\s*"([^"]{1,128})"/g))i.add(n[1]);for(const n of e.matchAll(/"id"\s*:\s*"([^"]{1,128})"[\s\S]{0,400}?"type"\s*:\s*"LOCAL_TOOL_REQUEST"/g))i.add(n[1]);return[...i]}function U(s,t){const e=s.body,i=e?`${e.innerText??""}
${v(e)}`:"";return i.includes("LOCAL_TOOL_RESULT")?i.includes(`"requestId": "${t}"`)||i.includes(`"requestId":"${t}"`)||new RegExp(`"requestId"\\s*:\\s*"${xt(t)}"`).test(i):!1}function xt(s){return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function Tt(){const s=tt(location.href);if(!s)return;new kt(s).init()}Tt()})();
//# sourceMappingURL=content-script.js.map
