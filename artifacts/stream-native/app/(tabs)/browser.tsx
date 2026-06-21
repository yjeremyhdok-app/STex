import React, { useRef, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, Platform, ActivityIndicator, Animated, ScrollView, Dimensions, Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { BrowserAddToM3UModal } from "@/components/BrowserAddToM3UModal";

interface DetectedLink {
  url: string;
  type: string;
  permanent: boolean;        // true = no expiry/token indicators detected
  verified: "ok" | "expired" | "checking" | null;
  // Auto-probe result: permanent base URL found by stripping tokens
  permanentBase: string | null | "searching";
}

interface DetectedKey {
  method: string;      // AES-128 | SAMPLE-AES | clearkey | widevine | fairplay
  keyUri: string;      // URI from #EXT-X-KEY or license server
  keyHex: string;      // actual key bytes as hex (if captured)
  kidHex: string;      // Key ID hex (from PSSH or ClearKey)
  iv: string;          // IV from #EXT-X-KEY if present
  label: string;       // human-readable description
  kids: string[];      // KIDs from PSSH (may be multiple)
  contentId: string;   // FairPlay skd:// content ID
  licenseUrl: string;  // License server URL (captured from XHR)
  initHex: string;     // Raw FairPlay initData as hex (first 128 bytes)
}

// ─── Injected JS ──────────────────────────────────────────────────────────────
const INJECTED_JS = `
(function() {
  if (window.__streamInterceptorActive) return;
  window.__streamInterceptorActive = true;

  var detectedStreams = new Set();
  var detectedKeyUris = new Set();
  var mseSegmentBases = new Set();
  var _xhrCount = 0; var _fetchCount = 0;

  function post(msg) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); } catch(e) {}
  }

  // ── Diagnostic ping — confirms script is running ──
  post({ type: 'ping', ts: Date.now() });

  // ── Stream URL helpers ──
  function isStream(url) {
    if (!url || typeof url !== 'string' || url.length < 10 || url.indexOf('http') !== 0) return false;
    var l = url.toLowerCase();
    // strip query/hash for extension check
    var path = l.split('?')[0].split('#')[0];
    return path.indexOf('.m3u8') !== -1 || path.indexOf('.mpd') !== -1
      || path.indexOf('.flv') !== -1 || path.indexOf('.mp4') !== -1
      || path.indexOf('.ts') !== -1 || path.indexOf('.webm') !== -1
      || (l.indexOf('manifest') !== -1 && l.indexOf('.js') === -1)
      || (l.indexOf('playlist') !== -1 && l.indexOf('.js') === -1)
      || l.indexOf('/hls/') !== -1 || l.indexOf('/dash/') !== -1
      || l.indexOf('/stream/') !== -1 || l.indexOf('segment') !== -1
      || l.indexOf('chunklist') !== -1 || l.indexOf('live.m3u8') !== -1;
  }

  function streamType(url) {
    var l = url.toLowerCase().split('?')[0];
    if (l.indexOf('.m3u8') !== -1) return 'm3u8';
    if (l.indexOf('.mpd') !== -1) return 'dash';
    if (l.indexOf('.flv') !== -1) return 'flv';
    if (l.indexOf('.mp4') !== -1) return 'mp4';
    if (l.indexOf('.ts') !== -1) return 'm3u8';
    if (l.indexOf('.webm') !== -1) return 'webm';
    if (l.indexOf('manifest') !== -1) return 'dash';
    return 'stream';
  }

  function sendStream(url) {
    if (!url) return;
    var clean = String(url).split('#')[0].trim();
    if (!clean || detectedStreams.has(clean) || !isStream(clean)) return;
    detectedStreams.add(clean);
    post({ type: 'stream', url: clean, kind: streamType(clean) });
  }

  // ── Key helpers ──
  function bufToHex(buf) {
    return Array.from(new Uint8Array(buf)).map(function(b){ return ('0'+b.toString(16)).slice(-2); }).join('');
  }

  function parseM3U8Keys(text, baseUrl) {
    if (!text || text.indexOf('#EXT-X-KEY') === -1) return;
    var lines = text.split(/\\r?\\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.indexOf('#EXT-X-KEY') !== 0) continue;
      var methodM = line.match(/METHOD=([^,]+)/);
      var uriM = line.match(/URI="([^"]+)"/);
      var ivM = line.match(/IV=([^,\\s]+)/);
      if (!methodM) continue;
      var method = methodM[1];
      var uri = uriM ? uriM[1] : '';
      var iv = ivM ? ivM[1] : '';
      if (uri && uri.indexOf('http') !== 0) {
        try { uri = new URL(uri, baseUrl || window.location.href).href; } catch(e) {}
      }
      if (method === 'NONE') continue;
      if (uri && !detectedKeyUris.has(uri)) {
        detectedKeyUris.add(uri);
        var ml = method.toLowerCase();
        // FairPlay / Widevine dùng license protocol riêng — không fetch được bằng HTTP thường
        if (ml.indexOf('fps') !== -1 || ml.indexOf('fairplay') !== -1 || ml.indexOf('widevine') !== -1) {
          post({ type: 'key', method: method, keyUri: uri, keyHex: '', iv: iv, label: method + ' (DRM — không lấy được key)' });
        } else {
          // Fetch với timeout 5s
          var _fetch = window.__origFetch || window.fetch;
          var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
          var timer = ctrl ? setTimeout(function(){ ctrl.abort(); }, 5000) : null;
          _fetch(uri, { credentials: 'include', signal: ctrl ? ctrl.signal : undefined })
            .then(function(r){ if(timer) clearTimeout(timer); return r.arrayBuffer(); })
            .then(function(buf){
              post({ type: 'key', method: method, keyUri: uri, keyHex: bufToHex(buf), iv: iv, label: method + ' key' });
            })
            .catch(function(){
              if(timer) clearTimeout(timer);
              post({ type: 'key', method: method, keyUri: uri, keyHex: '', iv: iv, label: method + ' key (URI only)' });
            });
        }
      }
    }
  }

  // ── Scan text for streams + keys ──
  function scanText(text, sourceUrl) {
    if (!text || text.length < 4) return;
    // Stream URLs in JSON/HTML
    var rx = /https?:\\/\\/[^\\s"'<>\\\\]+\\.m3u8(?:\\?[^\\s"'<>\\\\]*)?/gi;
    var m;
    while ((m = rx.exec(text)) !== null) sendStream(m[0]);
    var rx2 = /https?:\\/\\/[^\\s"'<>\\\\]+\\.mpd(?:\\?[^\\s"'<>\\\\]*)?/gi;
    while ((m = rx2.exec(text)) !== null) sendStream(m[0]);
    // JSON field scan
    try { scanJsonObj(JSON.parse(text), 0); } catch(e) {}
    // M3U8 key parsing
    if (text.indexOf('#EXTM3U') !== -1 || text.indexOf('#EXT-X-') !== -1) {
      parseM3U8Keys(text, sourceUrl);
    }
  }

  // Field names that strongly suggest a stream/CDN URL value
  var STREAM_FIELD_NAMES = [
    'url','src','source','stream','hls','dash','link','file','href',
    'baseurl','streamurl','manifesturl','playbackurl','videourl','cdnurl',
    'liveurl','vodurl','mediaurl','contenturl','hlsurl','m3u8url','mpd',
    'stream_url','base_url','manifest','playlist','cdn','media','live',
    'vod','path','location','address','endpoint','uri','resource',
    'streamlink','videolink','streampath','videopath','hlslink','hlspath',
    'nguon','duong_link','link_xem','link_stream','link_hls',
  ];

  // Detect URL that looks like a streaming CDN resource (even without .m3u8 extension)
  function isStreamLikeUrl(url) {
    if (!url || typeof url !== 'string' || url.indexOf('http') !== 0 || url.length < 15) return false;
    var l = url.toLowerCase().split('?')[0].split('#')[0];
    return l.indexOf('.m3u8') !== -1 || l.indexOf('.mpd') !== -1 || l.indexOf('.flv') !== -1
      || l.indexOf('/live/') !== -1 || l.indexOf('/vod/') !== -1 || l.indexOf('/hls/') !== -1
      || l.indexOf('/dash/') !== -1 || l.indexOf('/stream/') !== -1 || l.indexOf('/media/') !== -1
      || l.indexOf('livecdn') !== -1 || l.indexOf('streamcdn') !== -1 || l.indexOf('livestream') !== -1
      || l.indexOf('/channel/') !== -1 || l.indexOf('playback') !== -1 || l.indexOf('/manifest') !== -1
      || l.indexOf('/index.m3u8') !== -1 || l.indexOf('/playlist') !== -1
      || (l.indexOf('cdn') !== -1 && (l.indexOf('/live') !== -1 || l.indexOf('/stream') !== -1));
  }

  var detectedRawUrls = new Set();

  function sendRawUrl(url, fieldName) {
    if (!url || typeof url !== 'string') return;
    var clean = url.trim().split(' ')[0]; // trim spaces
    if (!clean || clean.indexOf('http') !== 0 || clean.length < 15) return;
    if (!isStreamLikeUrl(clean) && !isStream(clean)) return;
    if (detectedRawUrls.has(clean) || detectedStreams.has(clean)) return;
    detectedRawUrls.add(clean);
    post({ type: 'raw_url', url: clean, field: fieldName || '' });
  }

  function scanJsonObj(obj, depth, parentKey) {
    if (depth > 8 || !obj) return;
    if (typeof obj === 'string') {
      sendStream(obj);
      if (parentKey) sendRawUrl(obj, parentKey);
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach(function(v){ scanJsonObj(v, depth+1, parentKey); });
      return;
    }
    if (typeof obj === 'object') {
      Object.keys(obj).forEach(function(k) {
        var v = obj[k];
        var kl = k.toLowerCase();
        if (typeof v === 'string' && v.indexOf('http') === 0) {
          sendStream(v);
          // Extract as raw URL candidate if field name is stream-related OR URL looks like a stream CDN
          if (STREAM_FIELD_NAMES.indexOf(kl) !== -1 || isStreamLikeUrl(v)) {
            sendRawUrl(v, k);
          }
        } else {
          scanJsonObj(v, depth+1, k);
        }
      });
    }
  }

  // ── 1. XHR interceptor ──
  var OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    var xhr = new OrigXHR();
    var _url = '';
    var origOpen = xhr.open.bind(xhr);
    xhr.open = function(method, url) {
      _url = String(url);
      _xhrCount++;
      // Post first 3 XHR URLs as debug (so we know interceptor fires)
      if (_xhrCount <= 3) post({ type: 'net', kind: 'xhr', n: _xhrCount, url: _url.slice(0, 100) });
      sendStream(_url);
      return origOpen.apply(xhr, arguments);
    };
    xhr.addEventListener('load', function() {
      try {
        if (xhr.responseType === '' || xhr.responseType === 'text') scanText(xhr.responseText, _url);
      } catch(e) {}
      // Redirect detection — responseURL differs from request URL
      try {
        if (xhr.responseURL && xhr.responseURL !== _url) {
          var finalUrl = xhr.responseURL;
          sendStream(finalUrl);
          sendRawUrl(finalUrl, 'redirect');
          if (isStreamLikeUrl(finalUrl) || isStream(finalUrl)) {
            post({ type: 'redirect', from: _url.slice(0, 120), url: finalUrl });
          }
        }
      } catch(e) {}
      // License server detection (FairPlay/Widevine) — exclude analytics/tracking domains
      try {
        var ul = _url.toLowerCase();
        var isAnalytics = ul.indexOf('google-analytics') !== -1 || ul.indexOf('doubleclick') !== -1
          || ul.indexOf('analytics') !== -1 || ul.indexOf('tracking') !== -1 || ul.indexOf('gtag') !== -1;
        if (!isAnalytics && _url && (ul.indexOf('license') !== -1 || ul.indexOf('fairplay') !== -1
          || ul.indexOf('/drm/') !== -1 || ul.indexOf('keydelivery') !== -1
          || ul.indexOf('widevine') !== -1 || ul.indexOf('keyserver') !== -1
          || ul.indexOf('/key/') !== -1 || ul.indexOf('ckc') !== -1)) {
          post({ type: 'fps_license', url: _url, status: xhr.status });
        }
      } catch(e2) {}
    });
    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;

  // ── 2. fetch interceptor ──
  var origFetch = window.fetch;
  window.__origFetch = origFetch;  // expose for key fetching below
  window.fetch = function(input, init) {
    var url = typeof input === 'string' ? input
      : (input instanceof URL) ? input.href
      : (input && input.url) || '';
    _fetchCount++;
    // Post first 3 fetch URLs as debug
    if (_fetchCount <= 3) post({ type: 'net', kind: 'fetch', n: _fetchCount, url: url.slice(0, 100) });
    sendStream(url);
    var p = origFetch.apply(this, arguments);
    p.then(function(res) {
      try { var clone = res.clone(); clone.text().then(function(t){ scanText(t, url); }).catch(function(){}); } catch(e) {}
      // Redirect detection — response.url differs from requested url
      try {
        if (res.redirected && res.url && res.url !== url) {
          var finalUrl2 = res.url;
          sendStream(finalUrl2);
          sendRawUrl(finalUrl2, 'redirect');
          if (isStreamLikeUrl(finalUrl2) || isStream(finalUrl2)) {
            post({ type: 'redirect', from: url.slice(0, 120), url: finalUrl2 });
          }
        }
      } catch(e) {}
      // License server detection via fetch — exclude analytics
      try {
        var ul2 = url.toLowerCase();
        var isAnal = ul2.indexOf('google-analytics') !== -1 || ul2.indexOf('doubleclick') !== -1
          || ul2.indexOf('analytics') !== -1 || ul2.indexOf('tracking') !== -1 || ul2.indexOf('gtag') !== -1;
        if (!isAnal && url && (ul2.indexOf('license') !== -1 || ul2.indexOf('fairplay') !== -1
          || ul2.indexOf('/drm/') !== -1 || ul2.indexOf('keydelivery') !== -1
          || ul2.indexOf('widevine') !== -1 || ul2.indexOf('keyserver') !== -1
          || ul2.indexOf('/key/') !== -1 || ul2.indexOf('ckc') !== -1)) {
          post({ type: 'fps_license', url: url, status: res.status });
        }
      } catch(e2) {}
    }).catch(function(){});
    return p;
  };

  // ── 3. video.src setter ──
  try {
    var desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (desc && desc.set) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        get: desc.get, configurable: true,
        set: function(u) { sendStream(String(u)); return desc.set.call(this, u); }
      });
    }
  } catch(e) {}

  // ── 4. setAttribute ──
  var origSetAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if ((name === 'src' || name === 'data-src') && this.tagName &&
        (this.tagName === 'VIDEO' || this.tagName === 'SOURCE')) {
      sendStream(String(value));
    }
    return origSetAttr.apply(this, arguments);
  };

  // ── 5. Hls.js ──
  function patchHls(Hls) {
    if (!Hls || Hls.__patched) return; Hls.__patched = true;
    var orig = Hls.prototype.loadSource;
    if (orig) Hls.prototype.loadSource = function(u) { sendStream(String(u)); return orig.apply(this, arguments); };
  }
  var hc = setInterval(function(){ if(window.Hls){ patchHls(window.Hls); clearInterval(hc); } }, 200);
  setTimeout(function(){ clearInterval(hc); }, 30000);

  // ── 6. Shaka Player ──
  function patchShaka() {
    if (!window.shaka || !window.shaka.Player || window.shaka.Player.__patched) return;
    window.shaka.Player.__patched = true;
    var orig = window.shaka.Player.prototype.load;
    if (orig) window.shaka.Player.prototype.load = function(u) { sendStream(String(u)); return orig.apply(this, arguments); };
  }
  var sc = setInterval(function(){ if(window.shaka){ patchShaka(); clearInterval(sc); } }, 200);
  setTimeout(function(){ clearInterval(sc); }, 30000);

  // ── 6b. DOM scan on load — bắt src có sẵn trong HTML ──
  function domScan() {
    try {
      // video/source[src]
      var els = document.querySelectorAll('video[src],source[src]');
      for (var i = 0; i < els.length; i++) sendStream(els[i].getAttribute('src') || '');
      // scan all script[type=application/json] & __NEXT_DATA__ etc.
      var scripts = document.querySelectorAll('script');
      for (var j = 0; j < scripts.length; j++) {
        var t = scripts[j].textContent || '';
        if (t.length > 20 && t.length < 500000) scanText(t, window.location.href);
      }
      // scan meta tags with content URLs
      var metas = document.querySelectorAll('meta[content]');
      for (var k = 0; k < metas.length; k++) sendStream(metas[k].getAttribute('content') || '');
    } catch(e) {}
  }
  // Run after DOM ready + again after 2s for SPAs
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', domScan);
  } else {
    domScan();
  }
  setTimeout(domScan, 2000);
  setTimeout(domScan, 5000);

  // ── 7. DRM Engine (var expressions — safe on all iOS JavaScriptCore versions) ──
  var bufToHexFull = function(buf) {
    return Array.from(new Uint8Array(buf)).map(function(b){ return ('0'+b.toString(16)).slice(-2); }).join('');
  };
  var b64urlToHex = function(b64) {
    try {
      var b = b64.replace(/-/g,'+').replace(/_/g,'/');
      while (b.length % 4) b += '=';
      var bin = atob(b); var hex = '';
      for (var _i=0;_i<bin.length;_i++) hex += ('0'+bin.charCodeAt(_i).toString(16)).slice(-2);
      return hex;
    } catch(e) { return ''; }
  };
  var extractKidsFromPSSH = function(ab) {
    var kids = [];
    try {
      var dv = new DataView(ab instanceof ArrayBuffer ? ab : ab.buffer);
      var off = 0;
      while (off < dv.byteLength - 8) {
        var boxSize = dv.getUint32(off);
        var boxType = String.fromCharCode(dv.getUint8(off+4),dv.getUint8(off+5),dv.getUint8(off+6),dv.getUint8(off+7));
        if (boxType === 'pssh' && boxSize > 32) {
          var ver = dv.getUint8(off + 8);
          if (ver >= 1) {
            var kidCount = dv.getUint32(off + 28);
            for (var _k = 0; _k < kidCount && _k < 16; _k++) {
              var kidOff = off + 32 + _k * 16;
              var kid = '';
              for (var _j = 0; _j < 16; _j++) kid += ('0'+dv.getUint8(kidOff+_j).toString(16)).slice(-2);
              if (kids.indexOf(kid) === -1) kids.push(kid);
            }
          }
        }
        if (boxSize <= 0) break;
        off += boxSize;
      }
    } catch(e) {}
    return kids;
  };
  try {
    if (navigator.requestMediaKeySystemAccess) {
      var origRMKSA = navigator.requestMediaKeySystemAccess.bind(navigator);
      navigator.requestMediaKeySystemAccess = function(keySystem, configs) {
        var p = origRMKSA(keySystem, configs);
        p.then(function(access) {
          var origCMKS = access.createMediaKeys.bind(access);
          access.createMediaKeys = function() {
            return origCMKS().then(function(mk) {
              var origCMKSession = mk.createSession.bind(mk);
              mk.createSession = function(sessionType) {
                var session = origCMKSession(sessionType);
                var origGR = session.generateRequest.bind(session);
                session.generateRequest = function(initDataType, initData) {
                  try {
                    var ab = initData instanceof ArrayBuffer ? initData : (initData.buffer ? initData.buffer : initData);
                    var kids = extractKidsFromPSSH(ab);
                    var contentId = '';
                    if (initDataType === 'skd' || (kids.length === 0 && initData.byteLength < 512)) {
                      try {
                        var str2 = new TextDecoder('utf-8',{fatal:false}).decode(ab);
                        var sIdx = str2.indexOf('skd://');
                        if (sIdx !== -1) {
                          contentId = str2.substring(sIdx);
                          var nIdx = contentId.indexOf(String.fromCharCode(0));
                          if (nIdx !== -1) contentId = contentId.slice(0, nIdx);
                          contentId = contentId.trim();
                        }
                      } catch(e2) {}
                    }
                    post({ type: 'drm', keySystem: keySystem, initDataType: initDataType, kids: kids, contentId: contentId });
                  } catch(e) {}
                  return origGR(initDataType, initData);
                };
                var origUpdate = session.update.bind(session);
                session.update = function(response) {
                  try {
                    var rtext = new TextDecoder().decode(response instanceof ArrayBuffer ? response : response.buffer || response);
                    var rjson = JSON.parse(rtext);
                    if (rjson.keys && Array.isArray(rjson.keys)) {
                      rjson.keys.forEach(function(rk) {
                        var keyHex = rk.k ? b64urlToHex(rk.k) : '';
                        var kidHex = rk.kid ? b64urlToHex(rk.kid) : '';
                        if (keyHex) post({ type: 'clearkey', kidHex: kidHex, keyHex: keyHex });
                      });
                    }
                  } catch(e) {}
                  return origUpdate(response);
                };
                return session;
              };
              return mk;
            });
          };
          return access;
        }).catch(function(){});
        return p;
      };
    }
  } catch(e) {}

  // ── 7b. WebKit FairPlay (var expressions — no function declarations in blocks) ──
  var decodeFPSContentId = function(data) {
    try {
      var u8 = data instanceof Uint8Array ? data : new Uint8Array(data.buffer || data);
      var dstr = '';
      try { dstr = new TextDecoder('utf-8',{fatal:false}).decode(u8); } catch(e) {}
      var di = dstr.indexOf('skd://');
      if (di !== -1) { var de = dstr.indexOf(String.fromCharCode(0),di); return dstr.slice(di, de !== -1 ? de : undefined).trim(); }
      var lat = '';
      for (var _li=0;_li<Math.min(u8.length,512);_li++) lat += String.fromCharCode(u8[_li]);
      var li2 = lat.indexOf('skd://');
      if (li2 !== -1) { var le2 = lat.indexOf(String.fromCharCode(0),li2); return lat.slice(li2, le2 !== -1 ? le2 : undefined).trim(); }
    } catch(e) {}
    return '';
  };
  try {
    var _watchedVideos = new WeakSet();
    var _watchVideo = function(v) {
      if (_watchedVideos.has(v)) return;
      _watchedVideos.add(v);
      v.addEventListener('webkitneedkey', function(e) {
        try {
          var contentId = decodeFPSContentId(e.initData);
          var u8raw = e.initData instanceof Uint8Array ? e.initData : new Uint8Array(e.initData.buffer || e.initData);
          var initHex = '';
          for (var _hi = 0; _hi < Math.min(u8raw.length, 128); _hi++) {
            initHex += ('0' + u8raw[_hi].toString(16)).slice(-2);
          }
          if (!contentId) {
            var printable = '';
            for (var _pi = 0; _pi < Math.min(u8raw.length, 256); _pi++) {
              var _ch = u8raw[_pi];
              if (_ch >= 32 && _ch < 127) printable += String.fromCharCode(_ch);
            }
            var _urlM = printable.match(/https?:\\/\\/\\S+/);
            if (_urlM) contentId = _urlM[0];
            else if (printable.trim().length > 2) contentId = printable.trim();
          }
          post({ type: 'fps_needkey', contentId: contentId, initHex: initHex });
        } catch(ex) {}
      });
    };
    var _existingVids = document.querySelectorAll('video');
    for (var _vi=0;_vi<_existingVids.length;_vi++) _watchVideo(_existingVids[_vi]);
    new MutationObserver(function(muts) {
      muts.forEach(function(m) {
        m.addedNodes.forEach(function(node) {
          if (node.tagName === 'VIDEO') _watchVideo(node);
          if (node.querySelectorAll) { var vs=node.querySelectorAll('video'); for(var _vj=0;_vj<vs.length;_vj++) _watchVideo(vs[_vj]); }
        });
      });
    }).observe(document.documentElement, { childList:true, subtree:true });
    if (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype.webkitSetMediaKeys) {
      var origWSMK = HTMLMediaElement.prototype.webkitSetMediaKeys;
      HTMLMediaElement.prototype.webkitSetMediaKeys = function(keys) {
        try { if (keys && keys.keySystem) post({ type:'key', method:keys.keySystem, keyUri:'', keyHex:'', iv:'', label:'WebKit DRM: '+keys.keySystem }); } catch(ex) {}
        return origWSMK.apply(this, arguments);
      };
    }
  } catch(e) {}

  // ── 8. MSE — Media Source Extensions (bắt link ẩn qua SourceBuffer) ──
  try {
    if (window.MediaSource) {
      var origAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
      MediaSource.prototype.addSourceBuffer = function(mime) {
        var sb = origAddSourceBuffer.apply(this, arguments);
        var origAppend = sb.appendBuffer.bind(sb);
        sb.appendBuffer = function(data) {
          try {
            // Scan ArrayBuffer for URLs
            var text = new TextDecoder('utf-8', { fatal: false }).decode(
              data instanceof ArrayBuffer ? data : data.buffer
            );
            scanText(text, window.location.href);
          } catch(e) {}
          return origAppend(data);
        };
        return sb;
      };
    }
  } catch(e) {}

  // ── 9. URL.createObjectURL — bắt MediaSource blob: URLs ──
  try {
    var origCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function(obj) {
      var blobUrl = origCreateObjectURL(obj);
      if (obj instanceof MediaSource) {
        post({ type: 'mse_notice', message: 'Trang dùng MSE — đang theo dõi SourceBuffer segments...' });
      }
      return blobUrl;
    };
  } catch(e) {}

  // ── 10. WebSocket — một số stream dùng WS ──
  try {
    var OrigWS = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      var u = String(url);
      if (u.indexOf('ws') === 0) {
        var httpUrl = u.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
        sendStream(httpUrl);
        post({ type: 'stream', url: httpUrl, kind: 'ws' });
      }
      return protocols ? new OrigWS(url, protocols) : new OrigWS(url);
    };
    window.WebSocket.prototype = OrigWS.prototype;
    window.WebSocket.CONNECTING = OrigWS.CONNECTING;
    window.WebSocket.OPEN = OrigWS.OPEN;
    window.WebSocket.CLOSING = OrigWS.CLOSING;
    window.WebSocket.CLOSED = OrigWS.CLOSED;
  } catch(e) {}

  // ── 11. DOM scan ──
  function scanDOM() {
    document.querySelectorAll('video,source').forEach(function(el) {
      var src = el.src || el.getAttribute('src') || el.getAttribute('data-src') || '';
      if (src) sendStream(src);
    });
    document.querySelectorAll('script:not([src])').forEach(function(s) { scanText(s.textContent||'', window.location.href); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scanDOM);
  else scanDOM();
  new MutationObserver(function(){ scanDOM(); })
    .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src','data-src'] });

  // ── 12. iframe / frame detection ──
  var detectedIframes = new Set();
  function sendIframe(u) {
    if (!u || typeof u !== 'string') return;
    var clean = u.trim();
    if (!clean || clean === 'about:blank' || clean === '' || detectedIframes.has(clean)) return;
    if (clean.indexOf('http') !== 0 && clean.indexOf('//') !== 0) return;
    detectedIframes.add(clean);
    post({ type: 'iframe', url: clean });
  }
  function scanIframes() {
    try {
      var els = document.querySelectorAll('iframe,frame,embed');
      for (var _if = 0; _if < els.length; _if++) {
        var el = els[_if];
        sendIframe(el.src || el.getAttribute('src') || '');
        sendIframe(el.getAttribute('data-src') || '');
        sendIframe(el.getAttribute('data-lazy-src') || '');
      }
    } catch(e) {}
  }
  // Initial scans
  setTimeout(scanIframes, 800);
  setTimeout(scanIframes, 2500);
  setTimeout(scanIframes, 5000);
  // Watch for dynamically added iframes
  new MutationObserver(function(muts) {
    muts.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (!node.tagName) return;
        if (node.tagName === 'IFRAME' || node.tagName === 'FRAME' || node.tagName === 'EMBED') {
          sendIframe(node.src || node.getAttribute('src') || '');
        }
        if (node.querySelectorAll) {
          var iframes = node.querySelectorAll('iframe,frame,embed');
          for (var _i2 = 0; _i2 < iframes.length; _i2++) sendIframe(iframes[_i2].src || iframes[_i2].getAttribute('src') || '');
        }
      });
      // attribute changes on existing iframes
      if (m.type === 'attributes' && m.target) {
        var t = m.target;
        if (t.tagName === 'IFRAME' || t.tagName === 'FRAME' || t.tagName === 'EMBED') {
          sendIframe(t.src || t.getAttribute('src') || '');
        }
      }
    });
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src','data-src'] });

  // ── 13. Deep page source scan (called via injectJavaScript from React) ──
  window.__scanPage = function() {
    try {
      // 1. Scan full HTML source for m3u8/mpd/flv/stream URLs
      var html = document.documentElement.outerHTML;
      var rxH = /https?:\\/\\/[^\\s"'<>\\\\]+\\.(?:m3u8|mpd|flv|ts|webm)(?:\\?[^\\s"'<>\\\\]*)?/gi;
      var mH;
      while ((mH = rxH.exec(html)) !== null) sendStream(mH[0]);
      // Also scan for CDN-like paths without extension
      var rxCdn = /https?:\\/\\/[a-zA-Z0-9._-]+\\/(?:live|vod|hls|stream|media|channel)[^\s"'<>\\\\]{4,120}/gi;
      while ((mH = rxCdn.exec(html)) !== null) sendRawUrl(mH[0].split('"')[0].split("'")[0], 'scan');
      // 2. Scan external script files
      var extScripts = document.querySelectorAll('script[src]');
      extScripts.forEach(function(s) {
        var src = s.getAttribute('src');
        if (!src || src.length < 5) return;
        var fullSrc = src.indexOf('http') === 0 ? src : (window.location.origin + (src.indexOf('/') === 0 ? '' : '/') + src);
        try {
          window.__origFetch(fullSrc, { credentials: 'omit' })
            .then(function(r) { return r.text(); })
            .then(function(t) { scanText(t, fullSrc); })
            .catch(function(){});
        } catch(e) {}
      });
      // 3. Scan inline scripts
      document.querySelectorAll('script:not([src])').forEach(function(s) {
        if (s.textContent && s.textContent.length > 10 && s.textContent.length < 1000000)
          scanText(s.textContent, window.location.href);
      });
      // 4. Scan iframes
      scanIframes();
      // 5. Scan window variables for stream URLs
      try {
        var winKeys = Object.keys(window);
        for (var _wk = 0; _wk < Math.min(winKeys.length, 200); _wk++) {
          try {
            var wv = window[winKeys[_wk]];
            if (typeof wv === 'string' && wv.indexOf('http') === 0) sendRawUrl(wv, 'window.'+winKeys[_wk]);
            else if (wv && typeof wv === 'object') scanJsonObj(wv, 0, winKeys[_wk]);
          } catch(e) {}
        }
      } catch(e) {}
      post({ type: 'scan_done' });
    } catch(e) {
      post({ type: 'scan_done' });
    }
  };

  true;
})();
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function streamColor(type: string) {
  if (type === "m3u8") return "#00d4ff";
  if (type === "dash") return "#f59e0b";
  if (type === "mp4") return "#10b981";
  if (type === "ws") return "#f97316";
  return "#6b7280";
}
function keyColor(method: string) {
  const l = method.toLowerCase();
  if (l.includes("aes")) return "#a855f7";
  if (l.includes("widevine")) return "#ef4444";
  if (l.includes("fairplay")) return "#ef4444";
  if (l.includes("clearkey")) return "#f59e0b";
  return "#6b7280";
}

// Token/expiry param names to strip when probing for permanent base
const STRIP_PARAMS = [
  "token", "expires", "expire", "exp", "e", "end",
  "sign", "sig", "signature", "auth", "access_token",
  "cdn_token", "st", "etime", "etm", "ts",
  "x-amz-security-token", "x-amz-expires", "x-amz-signature",
  "policy", "key-pair-id", "awsaccesskeyid",
  "hdnts", "hdntl", "hmac",
  // Vietnamese CDN common params
  "wmsAuthSign", "nimblesessionid", "wowzasessionid",
  "playlistid", "cdn_auth", "vod_token",
];

/**
 * Build candidate "clean" URLs from a tokenized URL.
 * Returns deduplicated list of URLs to probe, in priority order.
 */
function buildUrlVariants(url: string): string[] {
  try {
    const u = new URL(url);
    const candidates: string[] = [];

    // 1. Strip only known token params, keep the rest
    const stripped = new URL(url);
    for (const key of Array.from((stripped.searchParams as unknown as { keys(): Iterable<string> }).keys())) {
      if (STRIP_PARAMS.some((k) => key.toLowerCase() === k)) {
        stripped.searchParams.delete(key);
      }
      // Also strip params with long token-like values
      const val = stripped.searchParams.get(key) ?? "";
      if (/^\d{10,11}$/.test(val) || (val.length > 24 && /^[A-Za-z0-9+/=_-]{24,}$/.test(val))) {
        stripped.searchParams.delete(key);
      }
    }
    if (stripped.href !== url) candidates.push(stripped.href);

    // 2. No query params at all (most aggressive strip)
    const noQuery = u.origin + u.pathname;
    if (noQuery !== url && noQuery !== stripped.href) candidates.push(noQuery);

    // 3. If path has a long hex segment (32+ chars), try removing it
    // e.g. /live/a3f8c2.../index.m3u8 → /live/index.m3u8
    const pathParts = u.pathname.split("/");
    const cleanedParts = pathParts.filter((p) => !/^[a-f0-9]{32,}$/i.test(p));
    if (cleanedParts.length !== pathParts.length) {
      const cleanPath = u.origin + cleanedParts.join("/");
      candidates.push(cleanPath);
      // Also without query
      if (cleanPath !== noQuery) candidates.push(cleanPath.split("?")[0]);
    }

    return [...new Set(candidates)].slice(0, 5); // max 5 candidates
  } catch {
    return [];
  }
}

/**
 * Probe candidate URLs to find a permanent working base.
 * Returns the first URL that returns a valid m3u8 response, or null.
 */
async function probeForPermanentBase(tokenizedUrl: string): Promise<string | null> {
  const candidates = buildUrlVariants(tokenizedUrl);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(candidate, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
          "Accept": "*/*",
        },
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const text = await res.text();
      if (text.includes("#EXTM3U") || text.includes("#EXT-X-") || text.includes(".ts")) {
        return candidate; // ✓ works without token!
      }
    } catch {
      // timed out or network error → try next
    }
  }
  return null;
}

/**
 * Kiểm tra URL có phải link cố định không.
 * Link cố định = không có token/expiry/signature trong query params.
 */
function isPermanentUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const params = u.searchParams;
    // Known expiry/auth param names
    const EXPIRY_KEYS = [
      "token", "expires", "expire", "exp", "e", "end",
      "sign", "sig", "signature", "auth", "access_token",
      "cdn_token", "st", "etime", "etm", "ts",
      // AWS CloudFront/S3
      "x-amz-security-token", "x-amz-expires", "x-amz-signature",
      "policy", "key-pair-id", "awsaccesskeyid",
      // Akamai / generic CDN
      "hdnts", "hdntl", "hmac",
    ];
    for (const key of EXPIRY_KEYS) {
      if (params.has(key)) return false;
      // case-insensitive check
      for (const k of Array.from((params as unknown as { keys(): Iterable<string> }).keys())) {
        if (k.toLowerCase() === key) return false;
      }
    }
    // Check for Unix timestamp values (10-digit numbers) in any param
    for (const val of Array.from((params as unknown as { values(): Iterable<string> }).values())) {
      if (/^\d{10,11}$/.test(val)) return false;          // Unix timestamp
      if (val.length > 24 && /^[A-Za-z0-9+/=_-]{24,}$/.test(val)) return false; // long base64/hex token
    }
    // Check path for token-looking segments (32+ hex chars)
    const pathParts = u.pathname.split("/");
    for (const part of pathParts) {
      if (/^[a-f0-9]{32,}$/i.test(part)) return false;   // UUID-like or long hex token in path
    }
    return true;
  } catch {
    return false;
  }
}

/** Rút gọn URL: host + 2 segment cuối của path để phân biệt các link giống nhau */
function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const parts = u.pathname.split("/").filter(Boolean);
    // Lấy tối đa 2 segment cuối để phân biệt (vd: VTV1_HD/index.m3u8)
    const tail = parts.slice(-2).join("/");
    if (!tail) return host;
    // Cắt bớt nếu quá dài
    const shortTail = tail.length > 32 ? tail.slice(0, 14) + "…" + tail.slice(-12) : tail;
    return host + "/" + shortTail;
  } catch {
    return url.slice(0, 45);
  }
}

// ─── Web fallback ─────────────────────────────────────────────────────────────
function WebFallback() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, styles.fallbackCenter, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <Feather name="smartphone" size={52} color={colors.primary} style={{ marginBottom: 20 }} />
      <Text style={[styles.fallbackTitle, { color: colors.foreground }]}>Mở trên Expo Go</Text>
      <Text style={[styles.fallbackSub, { color: colors.mutedForeground }]}>
        Trình duyệt tích hợp chỉ hoạt động trên thiết bị thật (iOS / Android).{"\n\n"}
        Quét QR code bằng <Text style={{ color: colors.primary }}>Expo Go</Text> để dùng tính năng này.
      </Text>
    </View>
  );
}

// ─── Native browser ───────────────────────────────────────────────────────────
function NativeBrowser() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebView } = require("react-native-webview") as typeof import("react-native-webview");

  const webViewRef = useRef<InstanceType<typeof WebView>>(null);
  const [url, setUrl] = useState("https://google.com");
  const [inputUrl, setInputUrl] = useState("https://google.com");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(false);
  const [links, setLinks] = useState<DetectedLink[]>([]);
  const [keys, setKeys] = useState<DetectedKey[]>([]);
  const [rawUrls, setRawUrls] = useState<{ url: string; field: string; permanent: boolean; kind: "api" | "iframe" | "redirect" | "scan" }[]>([]);
  const [scanning, setScanning] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"streams" | "raw" | "keys">("streams");
  const panelAnim = useRef(new Animated.Value(0)).current;
  const [jsActive, setJsActive] = useState(false);
  const [netDebug, setNetDebug] = useState<{kind: string; url: string}[]>([]);
  const [addChModal, setAddChModal] = useState<{ visible: boolean; apiUrl: string; pageUrl: string }>({ visible: false, apiUrl: "", pageUrl: "" });

  const totalFound = links.length + keys.length + rawUrls.length;

  const navigate = useCallback((target: string) => {
    let nav = target.trim();
    if (!nav) return;
    if (!nav.startsWith("http://") && !nav.startsWith("https://")) {
      nav = nav.includes(".") && !nav.includes(" ")
        ? "https://" + nav
        : "https://www.google.com/search?q=" + encodeURIComponent(nav);
    }
    setUrl(nav); setInputUrl(nav);
    setLinks([]); setKeys([]); setRawUrls([]); setScanning(false);
    setJsActive(false); setNetDebug([]);
    setPanelOpen(false);
    Animated.spring(panelAnim, { toValue: 0, useNativeDriver: false }).start();
  }, [panelAnim]);

  const handleMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type: string; url?: string; kind?: string; n?: number; field?: string;
        method?: string; keyUri?: string; keyHex?: string; iv?: string; label?: string;
      };

      // ── Diagnostic messages ──
      if (data.type === "ping") { setJsActive(true); return; }
      if (data.type === "net") {
        setNetDebug((prev) => prev.length < 6 ? [...prev, { kind: data.kind || "?", url: data.url || "" }] : prev);
        return;
      }

      if (data.type === "stream" && data.url) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const permanent = isPermanentUrl(data.url!);
        setLinks((prev) => {
          if (prev.find((l) => l.url === data.url)) return prev;
          const entry: DetectedLink = {
            url: data.url!,
            type: data.kind || "stream",
            permanent,
            verified: null,
            permanentBase: permanent ? null : "searching",
          };
          const next = permanent ? [entry, ...prev] : [...prev, entry];
          if (next.length === 1) {
            setPanelOpen(true);
            setActiveTab("streams");
            Animated.spring(panelAnim, { toValue: 1, useNativeDriver: false, tension: 80, friction: 12 }).start();
          }
          return next;
        });
        // Auto-probe tokenized URLs for a clean permanent base in the background
        if (!permanent) {
          probeForPermanentBase(data.url!).then((base) => {
            setLinks((prev) => prev.map((l) =>
              l.url === data.url ? { ...l, permanentBase: base } : l
            ));
            if (base) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          });
        }
      }

      if (data.type === "raw_url" && data.url) {
        const permanent = isPermanentUrl(data.url);
        setRawUrls((prev) => {
          if (prev.find((r) => r.url === data.url)) return prev;
          const entry = { url: data.url!, field: data.field || "", permanent, kind: "api" as const };
          const next = permanent ? [entry, ...prev] : [...prev, entry];
          if (next.length === 1 && !panelOpen) {
            setPanelOpen(true); setActiveTab("raw");
            Animated.spring(panelAnim, { toValue: 1, useNativeDriver: false, tension: 80, friction: 12 }).start();
          }
          return next;
        });
        if (permanent) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      }

      if (data.type === "iframe" && data.url) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        const permanent = isPermanentUrl(data.url);
        setRawUrls((prev) => {
          if (prev.find((r) => r.url === data.url)) return prev;
          const entry = { url: data.url!, field: "iframe", permanent, kind: "iframe" as const };
          const next = [entry, ...prev]; // iframes always shown first — often contain players
          if (next.length === 1 && !panelOpen) {
            setPanelOpen(true); setActiveTab("raw");
            Animated.spring(panelAnim, { toValue: 1, useNativeDriver: false, tension: 80, friction: 12 }).start();
          }
          return next;
        });
        return;
      }

      if (data.type === "redirect" && data.url) {
        const permanent = isPermanentUrl(data.url);
        setRawUrls((prev) => {
          if (prev.find((r) => r.url === data.url)) return prev;
          const entry = { url: data.url!, field: "redirect", permanent, kind: "redirect" as const };
          return permanent ? [entry, ...prev] : [...prev, entry];
        });
        return;
      }

      if (data.type === "scan_done") {
        setScanning(false);
        return;
      }

      if (data.type === "key") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setKeys((prev) => {
          const inMethod = (data.method || "").toLowerCase();
          const isFpsKey = inMethod.includes("fps") || inMethod.includes("fairplay") || inMethod.includes("com.apple");

          // For FPS/FairPlay from webkitSetMediaKeys: merge into any existing FPS entry
          // (webkitneedkey fires first and creates the entry; webkitSetMediaKeys fires after)
          if (isFpsKey) {
            const existingFps = prev.find((k) =>
              k.method.toLowerCase().includes("fps") || k.method.toLowerCase().includes("fairplay") ||
              k.method.toLowerCase().includes("com.apple") || k.label.startsWith("DRM: com.apple")
            );
            if (existingFps) {
              return prev.map((k) => k === existingFps ? {
                ...k,
                // Prefer the more specific method string (com.apple.fps.1_0 over com.apple.fps)
                method: (data.method || "").length > k.method.length ? data.method! : k.method,
                label: k.contentId || k.initHex
                  ? k.label  // keep existing label if we already have useful data
                  : (data.label || k.label),
              } : k);
            }
          }

          // Normal dedup by keyUri + method
          const existing = prev.find((k) => k.keyUri === data.keyUri && k.method === data.method);
          if (existing) {
            if (data.keyHex && !existing.keyHex) {
              return prev.map((k) => k === existing ? { ...k, keyHex: data.keyHex! } : k);
            }
            return prev;
          }
          const entry: DetectedKey = {
            method: data.method || "unknown",
            keyUri: data.keyUri || "",
            keyHex: data.keyHex || "",
            kidHex: "",
            iv: data.iv || "",
            label: data.label || data.method || "key",
            kids: [],
            contentId: "",
            licenseUrl: "",
            initHex: "",
          };
          const next = [entry, ...prev];
          if (!panelOpen) {
            setPanelOpen(true);
            setActiveTab("keys");
            Animated.spring(panelAnim, { toValue: 1, useNativeDriver: false, tension: 80, friction: 12 }).start();
          }
          return next;
        });
      }

      // EME DRM analysis — KIDs from PSSH + FairPlay contentId
      if (data.type === "drm") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setKeys((prev) => {
          const ks = (data as any).keySystem as string || "unknown";
          const kidsArr: string[] = (data as any).kids || [];
          const cid: string = (data as any).contentId || "";
          const existing = prev.find((k) => k.method === ks && k.label.startsWith("DRM:"));
          if (existing) {
            const merged = [...new Set([...existing.kids, ...kidsArr])];
            return prev.map((k) => k === existing ? {
              ...k, kids: merged,
              contentId: cid || k.contentId,
            } : k);
          }
          const entry: DetectedKey = {
            method: ks, keyUri: "", keyHex: "", kidHex: "",
            iv: "", label: "DRM: " + ks, kids: kidsArr,
            contentId: cid, licenseUrl: "", initHex: "",
          };
          const next = [entry, ...prev];
          if (!panelOpen) {
            setPanelOpen(true); setActiveTab("keys");
            Animated.spring(panelAnim, { toValue: 1, useNativeDriver: false, tension: 80, friction: 12 }).start();
          }
          return next;
        });
      }

      // EME ClearKey — actual key+KID captured from license response
      if (data.type === "clearkey") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setKeys((prev) => {
          const kh = (data as any).keyHex as string || "";
          const kid = (data as any).kidHex as string || "";
          const existing = prev.find((k) =>
            (k.method.toLowerCase().includes("clearkey") || k.label.startsWith("DRM:")) && kid && k.kids.includes(kid)
          );
          if (existing) {
            return prev.map((k) => k === existing ? { ...k, keyHex: kh, kidHex: kid } : k);
          }
          const entry: DetectedKey = {
            method: "ClearKey", keyUri: "", keyHex: kh, kidHex: kid,
            iv: "", label: "ClearKey (key extracted ✓)", kids: kid ? [kid] : [],
            contentId: "", licenseUrl: "", initHex: "",
          };
          return [entry, ...prev];
        });
      }

      // WebKit FairPlay webkitneedkey — Content ID from initData
      if (data.type === "fps_needkey") {
        const cid: string = (data as any).contentId || "";
        const initHex: string = (data as any).initHex || "";
        if (cid || initHex) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setKeys((prev) => {
            const existing = prev.find((k) =>
              k.method.toLowerCase().includes("fps") || k.method.toLowerCase().includes("fairplay") ||
              k.label.startsWith("DRM: com.apple")
            );
            if (existing) {
              return prev.map((k) => k === existing ? {
                ...k,
                contentId: cid || k.contentId,
                initHex: initHex || k.initHex,
              } : k);
            }
            const entry: DetectedKey = {
              method: "com.apple.fps", keyUri: "", keyHex: "", kidHex: "",
              iv: "", label: "FairPlay (webkitneedkey)", kids: [],
              contentId: cid, licenseUrl: "", initHex,
            };
            return [entry, ...prev];
          });
        }
      }

      // XHR license server intercept — license URL
      if (data.type === "fps_license") {
        const lurl: string = (data as any).url || "";
        if (lurl) {
          setKeys((prev) => {
            const existing = prev.find((k) =>
              k.method.toLowerCase().includes("fps") || k.method.toLowerCase().includes("fairplay") ||
              k.label.startsWith("DRM: com.apple")
            );
            if (existing) {
              return prev.map((k) => k === existing ? { ...k, licenseUrl: lurl } : k);
            }
            return prev;
          });
        }
      }
    } catch { /* ignore */ }
  }, [panelAnim, panelOpen]);

  const togglePanel = () => {
    const to = panelOpen ? 0 : 1;
    setPanelOpen(!panelOpen);
    Animated.spring(panelAnim, { toValue: to, useNativeDriver: false, tension: 80, friction: 12 }).start();
  };

  const SCREEN_HEIGHT = Dimensions.get("window").height;
  const panelHeight = panelAnim.interpolate({ inputRange: [0, 1], outputRange: [0, Math.round(SCREEN_HEIGHT * 0.52)] });

  const copyText = async (text: string, label?: string) => {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  /** Fetch m3u8 URL and verify it returns valid content (no expiry / access error) */
  const verifyLink = useCallback(async (url: string) => {
    setLinks((prev) => prev.map((l) => l.url === url ? { ...l, verified: "checking" } : l));
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" },
      });
      clearTimeout(timer);
      if (!res.ok) {
        setLinks((prev) => prev.map((l) => l.url === url ? { ...l, verified: "expired" } : l));
        return;
      }
      const text = await res.text();
      const valid = text.includes("#EXTM3U") || text.includes("#EXT-X") || text.includes(".ts") || text.length > 20;
      setLinks((prev) => prev.map((l) => l.url === url ? { ...l, verified: valid ? "ok" : "expired" } : l));
      if (valid) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } catch {
      setLinks((prev) => prev.map((l) => l.url === url ? { ...l, verified: "expired" } : l));
    }
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Toolbar */}
      <View style={[styles.toolbar, { paddingTop: insets.top + 6, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <View style={styles.navRow}>
          <TouchableOpacity style={[styles.navBtn, { opacity: canGoBack ? 1 : 0.3 }]} onPress={() => webViewRef.current?.goBack()} disabled={!canGoBack}>
            <Feather name="chevron-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.navBtn, { opacity: canGoForward ? 1 : 0.3 }]} onPress={() => webViewRef.current?.goForward()} disabled={!canGoForward}>
            <Feather name="chevron-right" size={22} color={colors.foreground} />
          </TouchableOpacity>

          <View style={[styles.urlBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="globe" size={13} color={colors.mutedForeground} style={{ marginRight: 5 }} />
            <TextInput
              style={[styles.urlInput, { color: colors.foreground }]}
              value={inputUrl}
              onChangeText={setInputUrl}
              onFocus={() => { /* keep current inputUrl */ }}
              onSubmitEditing={() => navigate(inputUrl)}
              placeholder="Nhập URL hoặc tìm kiếm..."
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              selectTextOnFocus
            />
            {loading
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <TouchableOpacity onPress={() => webViewRef.current?.reload()}>
                  <Feather name="refresh-cw" size={15} color={colors.mutedForeground} />
                </TouchableOpacity>
            }
          </View>

          {/* Quét trang sâu */}
          <TouchableOpacity
            style={[styles.navBtn, scanning && { opacity: 0.6 }]}
            onPress={() => {
              if (scanning) return;
              setScanning(true);
              webViewRef.current?.injectJavaScript('window.__scanPage && window.__scanPage(); true;');
              // Safety timeout — if scan_done never arrives
              setTimeout(() => setScanning(false), 15000);
            }}
          >
            {scanning
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Feather name="search" size={18} color={rawUrls.some(r => r.kind === "iframe") ? "#a855f7" : colors.mutedForeground} />
            }
          </TouchableOpacity>

          <TouchableOpacity style={styles.navBtn} onPress={togglePanel}>
            {totalFound > 0
              ? <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.badgeText}>{totalFound}</Text>
                </View>
              : <Feather name="radio" size={20} color={colors.mutedForeground} />
            }
          </TouchableOpacity>
        </View>
      </View>

      {/* WebView */}
      <WebView
        ref={webViewRef}
        source={{ uri: url }}
        style={{ flex: 1 }}
        injectedJavaScript={INJECTED_JS}
        injectedJavaScriptBeforeContentLoaded={INJECTED_JS}
        onMessage={handleMessage}
        onNavigationStateChange={(state) => {
          setCanGoBack(state.canGoBack);
          setCanGoForward(state.canGoForward);
          if (state.url && state.url !== "about:blank") { setInputUrl(state.url); }
        }}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => setLoading(false)}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        allowsBackForwardNavigationGestures={Platform.OS === "ios"}
        userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      />

      {/* Panel — in flex flow, không overlay WebView */}
      <Animated.View style={[styles.panel, { height: panelHeight, backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Tabs */}
          <View style={[styles.tabRow, { borderBottomColor: colors.border }]}>
            {(["streams", "raw", "keys"] as const).map((tab) => {
              const count = tab === "streams" ? links.length : tab === "raw" ? rawUrls.length : keys.length;
              const active = activeTab === tab;
              const hasPermRaw = tab === "raw" && rawUrls.some((r) => r.permanent);
              return (
                <TouchableOpacity key={tab} style={[styles.tabBtn, active && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]} onPress={() => setActiveTab(tab)}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Text style={[styles.tabText, { color: active ? colors.primary : colors.mutedForeground }]}>
                      {tab === "streams" ? "Streams" : tab === "raw" ? "Gốc URL" : "Keys"} {count > 0 ? `(${count})` : ""}
                    </Text>
                    {hasPermRaw && (
                      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#22c55e" }} />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Streams list */}
          {activeTab === "streams" && (
            <FlatList
              data={links}
              keyExtractor={(item) => item.url}
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 10, gap: 8, paddingBottom: insets.bottom + 70 }}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={<Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>Chưa bắt được stream nào — hãy nhấn play video</Text>}
              renderItem={({ item }) => {
                const c = streamColor(item.type);
                const matchedKey = keys.find(k =>
                  k.keyHex && (k.method.toUpperCase().includes("AES") || k.method.toUpperCase().includes("SAMPLE"))
                );
                const ffmpegCmd = matchedKey?.keyHex
                  ? `ffmpeg -allowed_extensions ALL -protocol_whitelist file,http,https,tcp,tls,crypto -i "${item.url}" -c copy out.mp4`
                  : `ffmpeg -i "${item.url}" -c copy out.mp4`;
                const openVlc = () => {
                  Linking.openURL("vlc://" + item.url).catch(() =>
                    Linking.openURL("https://apps.apple.com/app/vlc-media-player/id650377962")
                  );
                };

                // Permanent / verified state colours
                const verifyColor =
                  item.verified === "ok" ? "#22c55e" :
                  item.verified === "expired" ? "#ef4444" :
                  item.verified === "checking" ? "#f59e0b" : null;
                const verifyLabel =
                  item.verified === "ok" ? "✓ Live" :
                  item.verified === "expired" ? "✗ Hết hạn" :
                  item.verified === "checking" ? "..." : "Test";

                return (
                  <View style={[styles.row, { backgroundColor: colors.background, borderColor: item.permanent ? "#22c55e55" : colors.border, flexDirection: "column", alignItems: "stretch", gap: 0 }]}>
                    {/* Status badges row */}
                    <View style={{ flexDirection: "row", gap: 6, marginBottom: 6 }}>
                      {/* Stream type chip */}
                      <View style={[styles.chip, { backgroundColor: c + "22", borderColor: c, flexShrink: 0 }]}>
                        <Text style={[styles.chipText, { color: c }]}>{item.type.toUpperCase()}</Text>
                      </View>
                      {/* Permanent / token badge */}
                      {item.permanent ? (
                        <View style={[styles.chip, { backgroundColor: "#22c55e22", borderColor: "#22c55e", flexShrink: 0 }]}>
                          <Text style={[styles.chipText, { color: "#22c55e" }]}>🔓 CỐ ĐỊNH</Text>
                        </View>
                      ) : (
                        <View style={[styles.chip, { backgroundColor: "#f59e0b22", borderColor: "#f59e0b", flexShrink: 0 }]}>
                          <Text style={[styles.chipText, { color: "#f59e0b" }]}>🔑 CÓ TOKEN</Text>
                        </View>
                      )}
                      {/* Live verified badge */}
                      {item.verified === "ok" && (
                        <View style={[styles.chip, { backgroundColor: "#22c55e22", borderColor: "#22c55e", flexShrink: 0 }]}>
                          <Text style={[styles.chipText, { color: "#22c55e" }]}>▶ LIVE</Text>
                        </View>
                      )}
                    </View>

                    {/* URL row */}
                    <TouchableOpacity
                      style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                      onPress={() => copyText(item.url)}
                      activeOpacity={0.75}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.monoText, { color: colors.mutedForeground, fontSize: 11 }]} numberOfLines={1} ellipsizeMode="middle">
                          {shortUrl(item.url)}
                        </Text>
                      </View>
                      <View style={[styles.copyBtn, { backgroundColor: colors.primary + "20", flexShrink: 0 }]}>
                        <Feather name="copy" size={14} color={colors.primary} />
                      </View>
                    </TouchableOpacity>

                    {/* Permanent base URL probe result */}
                    {!item.permanent && (
                      <View style={{ marginTop: 8 }}>
                        {item.permanentBase === "searching" ? (
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6,
                            backgroundColor: "#22c55e10", borderRadius: 8, borderWidth: 1,
                            borderColor: "#22c55e30", padding: 8 }}>
                            <ActivityIndicator size="small" color="#22c55e" />
                            <Text style={{ fontSize: 11, color: "#22c55e80" }}>Đang thử tìm link cố định...</Text>
                          </View>
                        ) : item.permanentBase ? (
                          /* ✓ Found a permanent base URL! */
                          <View style={{ backgroundColor: "#22c55e12", borderRadius: 8, borderWidth: 1.5,
                            borderColor: "#22c55e", padding: 10, gap: 6 }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <View style={{ backgroundColor: "#22c55e", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                                <Text style={{ fontSize: 10, color: "#fff", fontWeight: "800", letterSpacing: 0.5 }}>✓ LINK CỐ ĐỊNH TÌM ĐƯỢC</Text>
                              </View>
                            </View>
                            <TouchableOpacity
                              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                              onPress={() => copyText(item.permanentBase as string)}
                              activeOpacity={0.75}
                            >
                              <Text style={[styles.monoText, { color: "#22c55e", flex: 1, fontSize: 12 }]} numberOfLines={2} ellipsizeMode="middle">
                                {item.permanentBase}
                              </Text>
                              <TouchableOpacity
                                onPress={() => copyText(item.permanentBase as string)}
                                style={{ backgroundColor: "#22c55e30", borderRadius: 6, padding: 6, flexShrink: 0 }}
                              >
                                <Feather name="copy" size={14} color="#22c55e" />
                              </TouchableOpacity>
                            </TouchableOpacity>
                            {/* Open permanent URL in VLC */}
                            <TouchableOpacity
                              onPress={() => Linking.openURL("vlc://" + (item.permanentBase as string)).catch(() => {})}
                              style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
                                backgroundColor: "#ff690022", borderRadius: 6, paddingVertical: 5,
                                borderWidth: 1, borderColor: "#ff690055" }}
                            >
                              <Feather name="play-circle" size={13} color="#ff6900" />
                              <Text style={{ fontSize: 11, color: "#ff6900", fontWeight: "600" }}>Mở link cố định trong VLC</Text>
                            </TouchableOpacity>
                          </View>
                        ) : item.permanentBase === null ? (
                          /* Not found — CDN enforces token */
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6,
                            backgroundColor: "#ef444410", borderRadius: 8, borderWidth: 1,
                            borderColor: "#ef444430", padding: 8 }}>
                            <Feather name="lock" size={11} color="#ef4444" />
                            <Text style={{ fontSize: 11, color: "#ef444490" }}>CDN bắt buộc token — không có link cố định</Text>
                          </View>
                        ) : null}
                      </View>
                    )}

                    {/* Action buttons row */}
                    <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
                      {/* Test / Verify button */}
                      <TouchableOpacity
                        onPress={() => item.verified !== "checking" && verifyLink(item.url)}
                        disabled={item.verified === "checking"}
                        style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
                          backgroundColor: (verifyColor ?? colors.mutedForeground) + "20",
                          borderRadius: 6, paddingVertical: 5, borderWidth: 1,
                          borderColor: (verifyColor ?? colors.mutedForeground) + "55" }}
                      >
                        {item.verified === "checking"
                          ? <ActivityIndicator size="small" color="#f59e0b" />
                          : <Feather name="wifi" size={13} color={verifyColor ?? colors.mutedForeground} />
                        }
                        <Text style={{ fontSize: 11, color: verifyColor ?? colors.mutedForeground, fontWeight: "600" }}>{verifyLabel}</Text>
                      </TouchableOpacity>

                      {/* Open in VLC */}
                      <TouchableOpacity
                        onPress={openVlc}
                        style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
                          backgroundColor: "#ff6900" + "22", borderRadius: 6, paddingVertical: 5, borderWidth: 1, borderColor: "#ff6900" + "55" }}
                      >
                        <Feather name="play-circle" size={13} color="#ff6900" />
                        <Text style={{ fontSize: 11, color: "#ff6900", fontWeight: "600" }}>VLC</Text>
                      </TouchableOpacity>

                      {/* Copy ffmpeg command */}
                      <TouchableOpacity
                        onPress={() => copyText(ffmpegCmd, "ffmpeg")}
                        style={{ flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
                          backgroundColor: colors.primary + "15", borderRadius: 6, paddingVertical: 5, borderWidth: 1, borderColor: colors.primary + "40" }}
                      >
                        <Feather name="terminal" size={13} color={colors.primary} />
                        <Text style={{ fontSize: 11, color: colors.primary, fontWeight: "600" }}>ffmpeg</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Add to channel button */}
                    <TouchableOpacity
                      onPress={() => setAddChModal({ visible: true, apiUrl: item.url, pageUrl: url })}
                      style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
                        backgroundColor: "#22c55e18", borderRadius: 6, paddingVertical: 7,
                        borderWidth: 1, borderColor: "#22c55e50", marginTop: 2 }}
                    >
                      <Feather name="plus-circle" size={13} color="#22c55e" />
                      <Text style={{ fontSize: 11, color: "#22c55e", fontWeight: "700" }}>Thêm / sửa kênh</Text>
                    </TouchableOpacity>
                  </View>
                );
              }}
            />
          )}

          {/* Gốc URL — raw stream-like URLs found in API responses, iframes, redirects */}
          {activeTab === "raw" && (
            <FlatList
              data={rawUrls}
              keyExtractor={(item) => item.url}
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 10, gap: 8, paddingBottom: insets.bottom + 70 }}
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={
                <View style={{ backgroundColor: "#3b82f618", borderRadius: 8, borderWidth: 1, borderColor: "#3b82f635",
                  padding: 10, marginBottom: 8, gap: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Feather name="layers" size={13} color="#3b82f6" />
                    <Text style={{ fontSize: 12, color: "#3b82f6", fontWeight: "700" }}>URL gốc tìm được</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: "#3b82f680", lineHeight: 16 }}>
                    Bắt từ JSON API, iframe, redirect và source code trang.{"\n"}
                    🟢 CỐ ĐỊNH = không cần token · 🔴 CÓ TOKEN = cần token
                  </Text>
                  {/* Legend row */}
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    {[
                      { kind: "iframe", color: "#a855f7", label: "IFRAME" },
                      { kind: "redirect", color: "#f97316", label: "REDIRECT" },
                      { kind: "api", color: "#3b82f6", label: "API JSON" },
                      { kind: "scan", color: "#10b981", label: "QUÉT TRANG" },
                    ].map((l) => (
                      <View key={l.kind} style={{ flexDirection: "row", alignItems: "center", gap: 3,
                        backgroundColor: l.color + "18", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2,
                        borderWidth: 1, borderColor: l.color + "50" }}>
                        <Text style={{ fontSize: 9, color: l.color, fontWeight: "700" }}>{l.label}</Text>
                        <Text style={{ fontSize: 9, color: l.color + "80" }}>
                          {rawUrls.filter(r => r.kind === l.kind).length}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              }
              ListEmptyComponent={
                <View style={{ alignItems: "center", gap: 8, paddingTop: 20 }}>
                  <Feather name="search" size={32} color={colors.mutedForeground + "60"} />
                  <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>
                    Chưa tìm thấy URL gốc
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground + "80", textAlign: "center", lineHeight: 16 }}>
                    Nhấn 🔍 để quét sâu trang hiện tại{"\n"}
                    hoặc nhấn play video để bắt iframe/API
                  </Text>
                </View>
              }
              renderItem={({ item }) => {
                const kindColor = item.kind === "iframe" ? "#a855f7"
                  : item.kind === "redirect" ? "#f97316"
                  : item.kind === "scan" ? "#10b981"
                  : "#3b82f6";
                const kindLabel = item.kind === "iframe" ? "IFRAME"
                  : item.kind === "redirect" ? "REDIRECT"
                  : item.kind === "scan" ? "QUÉT TRANG"
                  : item.field ? `API · ${item.field}` : "API JSON";
                const permanentColor = item.permanent ? "#22c55e" : "#ef4444";
                return (
                <View style={{
                  backgroundColor: colors.background,
                  borderRadius: 10,
                  borderWidth: 1.5,
                  borderColor: item.kind === "iframe" ? "#a855f750"
                    : item.kind === "redirect" ? "#f9731650"
                    : item.permanent ? "#22c55e60" : "#6b728040",
                  padding: 10,
                  gap: 8,
                }}>
                  {/* Header: kind badge + permanent badge */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    {/* Kind badge */}
                    <View style={{ borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
                      backgroundColor: kindColor + "20", borderWidth: 1, borderColor: kindColor }}>
                      <Text style={{ fontSize: 9, fontWeight: "800", color: kindColor }}>{kindLabel}</Text>
                    </View>
                    {/* Permanent badge */}
                    <View style={{ borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
                      backgroundColor: permanentColor + "18", borderWidth: 1, borderColor: permanentColor + "80" }}>
                      <Text style={{ fontSize: 9, fontWeight: "800", color: permanentColor }}>
                        {item.permanent ? "🟢 CỐ ĐỊNH" : "🔴 CÓ TOKEN"}
                      </Text>
                    </View>
                  </View>

                  {/* URL text + copy */}
                  <TouchableOpacity
                    style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                    onPress={() => copyText(item.url)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.monoText, {
                      color: item.permanent ? "#22c55e" : item.kind === "iframe" ? "#a855f7" : colors.foreground,
                      flex: 1, fontSize: 11,
                    }]} numberOfLines={3} ellipsizeMode="middle">
                      {item.url}
                    </Text>
                    <View style={{ backgroundColor: kindColor + "20", borderRadius: 6, padding: 6, flexShrink: 0 }}>
                      <Feather name="copy" size={14} color={kindColor} />
                    </View>
                  </TouchableOpacity>

                  {/* Action buttons */}
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <TouchableOpacity
                      onPress={() => Linking.openURL("vlc://" + item.url).catch(() => {})}
                      style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
                        backgroundColor: "#ff690022", borderRadius: 6, paddingVertical: 6,
                        borderWidth: 1, borderColor: "#ff690055" }}
                    >
                      <Feather name="play-circle" size={13} color="#ff6900" />
                      <Text style={{ fontSize: 11, color: "#ff6900", fontWeight: "600" }}>VLC</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => copyText(`ffmpeg -i "${item.url}" -c copy out.mp4`, "ffmpeg")}
                      style={{ flex: 2, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
                        backgroundColor: colors.primary + "15", borderRadius: 6, paddingVertical: 6,
                        borderWidth: 1, borderColor: colors.primary + "40" }}
                    >
                      <Feather name="terminal" size={13} color={colors.primary} />
                      <Text style={{ fontSize: 11, color: colors.primary, fontWeight: "600" }}>ffmpeg</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Add to channel */}
                  <TouchableOpacity
                    onPress={() => setAddChModal({ visible: true, apiUrl: item.url, pageUrl: url })}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
                      backgroundColor: "#22c55e18", borderRadius: 6, paddingVertical: 7,
                      borderWidth: 1, borderColor: "#22c55e50", marginTop: 2 }}
                  >
                    <Feather name="plus-circle" size={13} color="#22c55e" />
                    <Text style={{ fontSize: 11, color: "#22c55e", fontWeight: "700" }}>Thêm / sửa kênh</Text>
                  </TouchableOpacity>
                </View>
              );
              }}
            />
          )}

          {/* Keys list */}
          {activeTab === "keys" && (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 10, gap: 10, paddingBottom: insets.bottom + 70 }} showsVerticalScrollIndicator={false}>
              {keys.length === 0 && (
                <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>Chưa bắt được key — stream mã hoá sẽ tự động bắt key khi play</Text>
              )}
              {keys.map((k, i) => {
                const c = keyColor(k.method);
                const isDrm = k.method.toLowerCase().includes("fps") ||
                              k.method.toLowerCase().includes("fairplay") ||
                              k.method.toLowerCase().includes("widevine") ||
                              k.label.includes("DRM:");
                const isAes = k.method.toLowerCase().includes("aes");
                const isClearKey = k.method.toLowerCase().includes("clearkey") || k.label.toLowerCase().includes("clearkey");
                // Build ffmpeg command for AES-128 streams (if we have key + matching stream)
                const firstStream = links[0]?.url || "";
                const ffmpegCmd = isAes && k.keyHex && firstStream
                  ? `ffmpeg -allowed_extensions ALL -protocol_whitelist file,http,https,tcp,tls,crypto -key_info_file key.info -i "${firstStream}" -c copy out.mp4`
                  : "";
                // Build mp4decrypt / shaka-packager style command for ClearKey
                const clearKeyCmd = isClearKey && k.keyHex && k.kidHex
                  ? `mp4decrypt --key ${k.kidHex}:${k.keyHex} encrypted.mp4 decrypted.mp4`
                  : (isClearKey && k.keyHex && k.kids[0]
                  ? `mp4decrypt --key ${k.kids[0]}:${k.keyHex} encrypted.mp4 decrypted.mp4`
                  : "");
                return (
                  <View key={i} style={[styles.keyCard, { backgroundColor: colors.background, borderColor: c + "60" }]}>
                    <View style={styles.keyHeader}>
                      <View style={[styles.chip, { backgroundColor: c + "22", borderColor: c }]}>
                        <Text style={[styles.chipText, { color: c }]}>{k.method.length > 20 ? k.method.slice(0,18)+"…" : k.method}</Text>
                      </View>
                      <Text style={[styles.keyLabel, { color: colors.mutedForeground }]} numberOfLines={1}>{k.label}</Text>
                    </View>

                    {/* Key hex — AES-128 / ClearKey */}
                    {!!k.keyHex && (
                      <TouchableOpacity style={[styles.keyValueRow, { borderColor: colors.border }]} onPress={() => copyText(k.keyHex)}>
                        <Text style={[styles.keyValueLabel, { color: colors.mutedForeground }]}>KEY</Text>
                        <Text style={[styles.monoText, { color: "#a855f7", flex: 1 }]} numberOfLines={1} ellipsizeMode="middle">{k.keyHex}</Text>
                        <Feather name="copy" size={13} color={colors.primary} />
                      </TouchableOpacity>
                    )}

                    {/* KID — from ClearKey or PSSH */}
                    {!!k.kidHex && (
                      <TouchableOpacity style={[styles.keyValueRow, { borderColor: colors.border }]} onPress={() => copyText(k.kidHex)}>
                        <Text style={[styles.keyValueLabel, { color: colors.mutedForeground }]}>KID</Text>
                        <Text style={[styles.monoText, { color: "#06b6d4", flex: 1 }]} numberOfLines={1} ellipsizeMode="middle">{k.kidHex}</Text>
                        <Feather name="copy" size={13} color={colors.primary} />
                      </TouchableOpacity>
                    )}

                    {/* Multiple KIDs from PSSH */}
                    {k.kids.filter(kid => kid !== k.kidHex).map((kid, ki) => (
                      <TouchableOpacity key={ki} style={[styles.keyValueRow, { borderColor: colors.border }]} onPress={() => copyText(kid)}>
                        <Text style={[styles.keyValueLabel, { color: colors.mutedForeground }]}>KID{ki + (k.kidHex ? 2 : 1)}</Text>
                        <Text style={[styles.monoText, { color: "#06b6d4", flex: 1 }]} numberOfLines={1} ellipsizeMode="middle">{kid}</Text>
                        <Feather name="copy" size={13} color={colors.primary} />
                      </TouchableOpacity>
                    ))}

                    {!!k.iv && (
                      <TouchableOpacity style={[styles.keyValueRow, { borderColor: colors.border }]} onPress={() => copyText(k.iv)}>
                        <Text style={[styles.keyValueLabel, { color: colors.mutedForeground }]}>IV</Text>
                        <Text style={[styles.monoText, { color: "#f59e0b", flex: 1 }]} numberOfLines={1} ellipsizeMode="middle">{k.iv}</Text>
                        <Feather name="copy" size={13} color={colors.primary} />
                      </TouchableOpacity>
                    )}

                    {!!k.keyUri && (
                      <TouchableOpacity style={[styles.keyValueRow, { borderColor: colors.border }]} onPress={() => copyText(k.keyUri)}>
                        <Text style={[styles.keyValueLabel, { color: colors.mutedForeground }]}>URI</Text>
                        <Text style={[styles.monoText, { color: colors.foreground, flex: 1 }]} numberOfLines={1} ellipsizeMode="middle">{k.keyUri}</Text>
                        <Feather name="copy" size={13} color={colors.primary} />
                      </TouchableOpacity>
                    )}

                    {/* FairPlay Content ID (skd:// or extracted text) */}
                    {!!k.contentId && (
                      <TouchableOpacity style={[styles.keyValueRow, { borderColor: colors.border }]} onPress={() => copyText(k.contentId)}>
                        <Text style={[styles.keyValueLabel, { color: "#f97316" }]}>CID</Text>
                        <Text style={[styles.monoText, { color: "#f97316", flex: 1 }]} numberOfLines={1} ellipsizeMode="middle">{k.contentId}</Text>
                        <Feather name="copy" size={13} color="#f97316" />
                      </TouchableOpacity>
                    )}

                    {/* FairPlay raw initData hex (when no CID decoded) */}
                    {!!k.initHex && (
                      <TouchableOpacity style={[styles.keyValueRow, { borderColor: colors.border }]} onPress={() => copyText(k.initHex)}>
                        <Text style={[styles.keyValueLabel, { color: "#94a3b8" }]}>INIT</Text>
                        <Text style={[styles.monoText, { color: "#94a3b8", flex: 1, fontSize: 10 }]} numberOfLines={1} ellipsizeMode="middle">{k.initHex}</Text>
                        <Feather name="copy" size={13} color="#94a3b8" />
                      </TouchableOpacity>
                    )}

                    {/* License server URL */}
                    {!!k.licenseUrl && (
                      <TouchableOpacity style={[styles.keyValueRow, { borderColor: colors.border }]} onPress={() => copyText(k.licenseUrl)}>
                        <Text style={[styles.keyValueLabel, { color: "#e879f9" }]}>LIC</Text>
                        <Text style={[styles.monoText, { color: "#e879f9", flex: 1 }]} numberOfLines={1} ellipsizeMode="middle">{k.licenseUrl}</Text>
                        <Feather name="copy" size={13} color="#e879f9" />
                      </TouchableOpacity>
                    )}

                    {/* ffmpeg decrypt command for AES-128 */}
                    {!!ffmpegCmd && (
                      <TouchableOpacity
                        style={[styles.cmdBox, { borderColor: "#22c55e44", backgroundColor: "#22c55e11" }]}
                        onPress={() => copyText(ffmpegCmd)}
                      >
                        <Text style={[styles.keyValueLabel, { color: "#22c55e" }]}>FFMPEG</Text>
                        <Text style={[styles.monoText, { color: "#22c55e", flex: 1, fontSize: 10 }]} numberOfLines={2}>{ffmpegCmd}</Text>
                        <Feather name="copy" size={13} color="#22c55e" />
                      </TouchableOpacity>
                    )}

                    {/* mp4decrypt command for ClearKey */}
                    {!!clearKeyCmd && (
                      <TouchableOpacity
                        style={[styles.cmdBox, { borderColor: "#a855f744", backgroundColor: "#a855f711" }]}
                        onPress={() => copyText(clearKeyCmd)}
                      >
                        <Text style={[styles.keyValueLabel, { color: "#a855f7" }]}>DECRYPT</Text>
                        <Text style={[styles.monoText, { color: "#a855f7", flex: 1, fontSize: 10 }]} numberOfLines={2}>{clearKeyCmd}</Text>
                        <Feather name="copy" size={13} color="#a855f7" />
                      </TouchableOpacity>
                    )}

                    {/* Status hint */}
                    {!k.keyHex && (
                      <Text style={[styles.keyHint, { color: colors.mutedForeground }]}>
                        {isDrm && k.contentId
                          ? `🔑 Content ID bắt được — cần license server để giải mã`
                          : isDrm && k.initHex
                          ? `🔍 Raw initData bắt được (${k.initHex.length / 2} bytes) — FairPlay mã hóa ở hardware, key không lấy được trên iOS`
                          : isDrm && k.kids.length > 0
                          ? `🔑 Đã bắt ${k.kids.length} KID — cần license server key`
                          : isDrm
                          ? "⚠️ DRM cứng — nhấn play video để kích hoạt EME và bắt CID/initData"
                          : "⏳ Đang fetch key... (tối đa 5s)"}
                      </Text>
                    )}
                    {isDrm && !!k.licenseUrl && !k.keyHex && (
                      <Text style={[styles.keyHint, { color: "#e879f9" }]}>🌐 License server đã bắt được — copy LIC để phân tích</Text>
                    )}
                    {isClearKey && !!k.keyHex && (
                      <Text style={[styles.keyHint, { color: "#22c55e" }]}>✅ Key lấy được — có thể giải mã video</Text>
                    )}
                    {isAes && !!k.keyHex && (
                      <Text style={[styles.keyHint, { color: "#22c55e" }]}>✅ AES-128 key — dùng ffmpeg để tải/giải mã</Text>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </Animated.View>

      <BrowserAddToM3UModal
        visible={addChModal.visible}
        onClose={() => setAddChModal((p) => ({ ...p, visible: false }))}
        prefillUrl={addChModal.apiUrl}
        prefillPageUrl={addChModal.pageUrl}
      />
    </View>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function BrowserScreen() {
  if (Platform.OS === "web") return <WebFallback />;
  return <NativeBrowser />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fallbackCenter: { alignItems: "center", justifyContent: "center", padding: 32 },
  fallbackTitle: { fontFamily: "Inter_700Bold", fontSize: 22, marginBottom: 12, textAlign: "center" },
  fallbackSub: { fontFamily: "Inter_400Regular", fontSize: 15, textAlign: "center", lineHeight: 24 },

  toolbar: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 8, paddingHorizontal: 8 },
  navRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  navBtn: { padding: 8 },
  urlBar: { flex: 1, flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, height: 38, gap: 4 },
  urlInput: { flex: 1, fontSize: 13, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", padding: 0 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  badgeText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 11 },

  panel: { borderTopWidth: StyleSheet.hairlineWidth, overflow: "hidden" },

  tabRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: "center" },
  tabText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },

  row: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, padding: 10, overflow: "hidden" },
  copyBtn: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  chip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5, borderWidth: 1 },
  chipText: { fontFamily: "Inter_700Bold", fontSize: 10 },
  monoText: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12 },
  emptyHint: { fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center", marginTop: 20, paddingHorizontal: 16 },

  keyCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  keyHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  keyLabel: { fontFamily: "Inter_400Regular", fontSize: 12 },
  keyValueRow: { flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  keyValueLabel: { fontFamily: "Inter_700Bold", fontSize: 10, width: 30 },
  keyHint: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 4 },
  cmdBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: 8, padding: 8 },
});
