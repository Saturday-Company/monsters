/*
 * The pages the monsters make (`artifact_create`) as they are served to the
 * preview pane (security review of 16/10, D-085). The sandbox CSP already
 * gives them an opaque origin and no fetch, but Chromium lets an
 * `RTCPeerConnection` with a STUN/TURN server send UDP out whatever the CSP
 * says (`webrtc 'block'` is not implemented). So, before any script of the
 * page, a lockdown script removes every API that can talk to the network,
 * and the page cannot get them back from a child frame:
 *
 * - a child frame of a sandboxed page has an origin of its own (an opaque
 *   one), so the page cannot reach into an `about:blank` frame; but a frame
 *   whose content the page writes (`srcdoc`) runs its own scripts with fresh
 *   constructors. No frame may exist at all: `<iframe>`, `<frame>`,
 *   `<object>`, `<embed>`… are renamed in the markup (here, when served) and
 *   in every HTML string the page parses later (a Trusted Types default
 *   policy, enforced by the CSP, plus the setters where Trusted Types are
 *   missing), and cannot be created from script;
 * - `document.write` is gone (a tag split across two writes would slip
 *   through), and so are workers.
 *
 * It is defence in depth: the pages of a run that read third-party text are
 * served with no scripts at all (`INERT_FILE_CSP`), and the desktop app keeps
 * WebRTC off proxied UDP.
 */

/** Elements that make a nested browsing context (a frame with its own scripts). */
export const FRAME_TAGS = [
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'portal',
  'fencedframe',
] as const;

/** A frame tag, also with an XML prefix (`<h:iframe>` in a document parsed as XHTML). */
const FRAME_TAG_RE = new RegExp(
  `<(/?)((?:[\\w.-]+:)?)(${FRAME_TAGS.join('|')})(?=[\\s/>]|$)`,
  'gi',
);
/** An XML entity could expand to a frame tag that is not written out anywhere. */
const ENTITY_RE = /<!ENTITY/gi;

/** `<iframe …>` → `<monsters-blocked-iframe …>`: an unknown element, inert. */
export function renameFrameTags(html: string): string {
  return html.replace(FRAME_TAG_RE, '<$1$2monsters-blocked-$3').replace(ENTITY_RE, '<!X-ENTITY');
}

/*
 * The script itself, as plain JavaScript (it runs in the page). Everything is
 * wrapped in try/catch: a browser without one of these APIs simply skips it.
 */
const LOCKDOWN_JS = String.raw`(function(){'use strict';
var W=window,B=${JSON.stringify(FRAME_TAGS)},RE=new RegExp(${JSON.stringify(FRAME_TAG_RE.source)},'gi');
function S(s){return String(s).replace(RE,'<$1$2monsters-blocked-$3').replace(/<!ENTITY/gi,'<!X-ENTITY')}
function kill(o,n,v){try{Object.defineProperty(o,n,{value:v,writable:false,configurable:false})}catch(e){try{delete o[n]}catch(e2){}}}
function no(){throw new DOMException('Not allowed in a Monsters page','SecurityError')}
var names=Object.getOwnPropertyNames(W);
for(var i=0;i<names.length;i++){if(/^(webkit|moz)?RTC|^WebTransport|^WebSocket|^EventSource$|^(Shared|Service)?Worker$|^XSLTProcessor$|^PresentationRequest$/.test(names[i]))kill(W,names[i],undefined)}
['RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel','RTCSessionDescription','RTCIceCandidate','WebTransport','WebSocket','WebSocketStream','EventSource','Worker','SharedWorker','XSLTProcessor','XMLHttpRequest','fetch'].forEach(function(n){kill(W,n,undefined)});
try{kill(Navigator.prototype,'sendBeacon',function(){return false})}catch(e){}
try{kill(W,'open',function(){return null})}catch(e){}
function blocked(n){return B.indexOf(String(n).toLowerCase())>=0}
try{var ce=Document.prototype.createElement;kill(Document.prototype,'createElement',function(n,o){if(blocked(n))no();return ce.call(this,n,o)})}catch(e){}
try{var cn=Document.prototype.createElementNS;kill(Document.prototype,'createElementNS',function(ns,n,o){var l=String(n).split(':').pop();if(blocked(l))no();return cn.call(this,ns,n,o)})}catch(e){}
try{var df=CustomElementRegistry.prototype.define;kill(CustomElementRegistry.prototype,'define',function(n,c,o){if(o&&o.extends&&blocked(o.extends))no();return df.call(this,n,c,o)})}catch(e){}
['write','writeln'].forEach(function(n){try{kill(Document.prototype,n,function(){})}catch(e){}});
[['HTMLIFrameElement',['contentWindow','contentDocument','srcdoc']],['HTMLFrameElement',['contentWindow','contentDocument']],['HTMLObjectElement',['contentWindow','contentDocument']]].forEach(function(p){var C=W[p[0]];if(!C)return;p[1].forEach(function(n){try{Object.defineProperty(C.prototype,n,{get:function(){return null},set:function(){},configurable:false})}catch(e){}})});
function wrapSetter(P,n){try{var d=Object.getOwnPropertyDescriptor(P,n);if(!d||!d.set)return;Object.defineProperty(P,n,{get:d.get,set:function(v){d.set.call(this,typeof v==='string'?S(v):v)},configurable:false})}catch(e){}}
function wrapArg(P,n,at){try{var f=P[n];if(typeof f!=='function')return;kill(P,n,function(){var a=Array.prototype.slice.call(arguments);if(typeof a[at]==='string')a[at]=S(a[at]);return f.apply(this,a)})}catch(e){}}
wrapSetter(Element.prototype,'innerHTML');wrapSetter(Element.prototype,'outerHTML');
if(W.ShadowRoot)wrapSetter(ShadowRoot.prototype,'innerHTML');
wrapArg(Element.prototype,'insertAdjacentHTML',1);wrapArg(Element.prototype,'setHTMLUnsafe',0);
if(W.ShadowRoot)wrapArg(ShadowRoot.prototype,'setHTMLUnsafe',0);
wrapArg(Element.prototype,'setHTML',0);if(W.ShadowRoot)wrapArg(ShadowRoot.prototype,'setHTML',0);
wrapArg(Range.prototype,'createContextualFragment',0);wrapArg(DOMParser.prototype,'parseFromString',0);
wrapArg(Document.prototype,'execCommand',2);
['parseHTMLUnsafe','parseHTML'].forEach(function(n){try{var f=Document[n];if(typeof f==='function')kill(Document,n,function(h,o){return f.call(Document,typeof h==='string'?S(h):h,o)})}catch(e){}});
try{if(W.trustedTypes&&W.trustedTypes.createPolicy)W.trustedTypes.createPolicy('default',{createHTML:function(s){return S(s)},createScript:function(s){return s},createScriptURL:function(s){return s}})}catch(e){}
try{var me=document.currentScript;if(me&&me.parentNode)me.parentNode.removeChild(me)}catch(e){}
})();`;

/** The lockdown script, as an inline `<script>` element. */
export const LOCKDOWN_SCRIPT = `<script>${LOCKDOWN_JS}</script>`;

/** CSP additions for scripted pages: no frames or workers, and Trusted Types enforced. */
export const LOCKDOWN_CSP = [
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "require-trusted-types-for 'script'",
  'trusted-types default',
];

const DOCTYPE = /^(\ufeff?\s*<!doctype[^>]*>)/i;

/**
 * The page as it is served with scripts: frame tags renamed, the lockdown
 * script first (after the doctype, so the page keeps its standards mode).
 */
export function lockDownHtml(html: string): string {
  const page = renameFrameTags(html);
  const head = DOCTYPE.exec(page)?.[1];
  if (!head) return LOCKDOWN_SCRIPT + page;
  return head + LOCKDOWN_SCRIPT + page.slice(head.length);
}
