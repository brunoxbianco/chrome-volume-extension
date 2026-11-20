// Runs in the page's MAIN world at document_start (all frames).
// Real output volume = volume requested by the page × tab level chosen in the popup.
// Nothing is read from the page and nothing is sent back to the extension.
(() => {
  'use strict';
  const EVENT = 'tvm-level-v1';
  const FLAG = Symbol.for('tab-volume-mixer.installed');
  if (window[FLAG]) return; // already installed (declarative + on-demand injection)
  Object.defineProperty(window, FLAG, { value: true });

  let level = 1;

  // ---- HTMLMediaElement (<audio>, <video>, new Audio()) ----
  const proto = HTMLMediaElement.prototype;
  const volumeDesc = Object.getOwnPropertyDescriptor(proto, 'volume');
  const nativeGet = volumeDesc.get;
  const nativeSet = volumeDesc.set;
  const desired = new WeakMap(); // element -> volume the page asked for
  const known = new Set(); // WeakRef<HTMLMediaElement>
  // Elements routed into an AudioContext via MediaElementAudioSourceNode. Chromium applies the element's
  // volume before the graph, and the graph already goes through our GainNode, so scaling the element too
  // would apply the level twice (50 % → 25 %). These elements keep the page's volume; the GainNode scales.
  const routed = new WeakSet();

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  function track(el) {
    if (!desired.has(el)) {
      desired.set(el, nativeGet.call(el));
      known.add(new WeakRef(el));
    }
  }

  function applyTo(el) {
    track(el);
    const target = routed.has(el) ? desired.get(el) : clamp01(desired.get(el) * level);
    if (Math.abs(nativeGet.call(el) - target) > 1e-4) nativeSet.call(el, target);
  }

  Object.defineProperty(proto, 'volume', {
    configurable: true,
    enumerable: volumeDesc.enumerable,
    get() {
      return desired.has(this) ? desired.get(this) : nativeGet.call(this);
    },
    set(value) {
      nativeSet.call(this, value); // keeps native validation (throws IndexSizeError on bad input)
      if (!desired.has(this)) known.add(new WeakRef(this));
      desired.set(this, nativeGet.call(this));
      applyTo(this);
    }
  });

  const nativePlay = proto.play;
  proto.play = function play(...args) {
    try { applyTo(this); } catch { /* never break playback */ }
    return nativePlay.apply(this, args);
  };

  // Elements that start playing without calling play() (autoplay attribute).
  document.addEventListener('play', (e) => {
    if (e.target instanceof HTMLMediaElement) applyTo(e.target);
  }, true);

  function applyAllMedia() {
    for (const el of document.querySelectorAll('audio, video')) track(el);
    for (const ref of known) {
      const el = ref.deref();
      if (el) applyTo(el); else known.delete(ref);
    }
  }

  // ---- Web Audio: route everything that targets ctx.destination through a GainNode ----
  const gains = new WeakMap(); // AudioContext -> GainNode
  const contexts = new Set(); // WeakRef<AudioContext>
  const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
  const nodeProto = window.AudioNode && AudioNode.prototype;
  const nativeConnect = nodeProto && nodeProto.connect;
  const nativeDisconnect = nodeProto && nodeProto.disconnect;

  function gainFor(dest) {
    const ctx = dest.context;
    if (!NativeAudioContext || !(ctx instanceof NativeAudioContext)) return null; // skip OfflineAudioContext
    let gain = gains.get(ctx);
    if (!gain) {
      try {
        gain = ctx.createGain();
        gain.gain.value = level;
        nativeConnect.call(gain, dest);
      } catch {
        return null;
      }
      gains.set(ctx, gain);
      contexts.add(new WeakRef(ctx));
    }
    return gain;
  }

  if (nativeConnect && window.AudioDestinationNode) {
    nodeProto.connect = function connect(target, ...rest) {
      if (target instanceof AudioDestinationNode) {
        const gain = gainFor(target);
        if (gain) {
          nativeConnect.call(this, gain, ...rest);
          return target; // same return value as the native call
        }
      }
      return nativeConnect.call(this, target, ...rest);
    };
    nodeProto.disconnect = function disconnect(target, ...rest) {
      if (target instanceof AudioDestinationNode) {
        const gain = gains.get(target.context);
        if (gain) return nativeDisconnect.call(this, gain, ...rest);
      }
      return nativeDisconnect.call(this, ...(arguments.length ? [target, ...rest] : []));
    };
  }

  function markRouted(ctx, el) {
    if (!(ctx instanceof NativeAudioContext) || !(el instanceof HTMLMediaElement)) return;
    try {
      routed.add(el);
      applyTo(el); // undo any element-level scaling already applied
    } catch { /* never break the page's graph */ }
  }

  if (NativeAudioContext) {
    const ctxProto = NativeAudioContext.prototype;
    const nativeCreateMES = ctxProto.createMediaElementSource;
    if (nativeCreateMES) {
      ctxProto.createMediaElementSource = function createMediaElementSource(el) {
        const node = nativeCreateMES.call(this, el); // throws natively on bad input / reuse
        markRouted(this, el);
        return node;
      };
    }
    // Constructor form: new MediaElementAudioSourceNode(ctx, { mediaElement }).
    // A Proxy keeps instanceof, prototype and static behaviour of the native constructor.
    if (window.MediaElementAudioSourceNode) {
      window.MediaElementAudioSourceNode = new Proxy(window.MediaElementAudioSourceNode, {
        construct(target, args, newTarget) {
          const node = Reflect.construct(target, args, newTarget);
          markRouted(args[0], args[1] && args[1].mediaElement);
          return node;
        }
      });
    }
  }

  function applyAllAudio() {
    for (const ref of contexts) {
      const ctx = ref.deref();
      const gain = ctx && gains.get(ctx);
      if (!gain) { contexts.delete(ref); continue; }
      try {
        if (ctx.state === 'closed') continue;
        gain.gain.setTargetAtTime(level, ctx.currentTime, 0.015); // smooth, click-free
      } catch {
        gain.gain.value = level;
      }
    }
  }

  // Registered on window in the capture phase at document_start, before any page script runs,
  // so page listeners cannot stopPropagation() the level update before it reaches us.
  window.addEventListener(EVENT, (e) => {
    const next = Number(e.detail);
    if (!Number.isFinite(next)) return;
    level = clamp01(next);
    applyAllMedia();
    applyAllAudio();
  }, true);
})();
