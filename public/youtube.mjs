let api;

function loadAPI() {
  if (!api) api = new Promise(resolve => {
    if (window.YT?.Player) { resolve(window.YT); return; }
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { api = undefined; resolve(null); };
    document.head.append(script);
  });
  return api;
}

export function youtubePlayer(container, events) {
  let frame;
  let player;

  function stop() {
    const old = player;
    player = undefined;
    frame = undefined;
    old?.destroy();
    container.replaceChildren();
    container.hidden = true;
  }

  return {
    active: () => Boolean(frame),
    stop,
    load(id, autoplay) {
      stop();
      const iframe = document.createElement('iframe');
      const url = new URL('https://www.youtube-nocookie.com/embed/' + id);
      url.search = new URLSearchParams({
        autoplay: autoplay ? '1' : '0', enablejsapi: '1', origin: location.origin, playsinline: '1', rel: '0',
      });
      iframe.src = url;
      iframe.title = 'Lecteur YouTube de cet enregistrement';
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      iframe.allowFullscreen = true;
      container.append(iframe);
      container.hidden = false;
      frame = iframe;
      loadAPI().then(YT => {
        if (frame !== iframe || !YT) return;
        player = new YT.Player(iframe, {
          events: {
            onStateChange({data}) {
              if (frame !== iframe) return;
              if (data === YT.PlayerState.ENDED) events.ended();
              else if (data === YT.PlayerState.PLAYING) events.change(true);
              else if (data === YT.PlayerState.PAUSED) events.change(false);
            },
            onError() { if (frame === iframe) events.error(); },
            onAutoplayBlocked() { if (frame === iframe) events.blocked(); },
          },
        });
      }).catch(() => {});
    },
    play() { player?.playVideo?.(); },
    pause() { player?.pauseVideo?.(); },
    seek(seconds) { player?.seekTo?.(seconds, true); },
    time() {
      const duration = player?.getDuration?.();
      return duration > 0 ? {duration, currentTime: player.getCurrentTime()} : null;
    },
  };
}
