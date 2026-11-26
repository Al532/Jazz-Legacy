let api;

function loadAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  api ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => {
      clearTimeout(timeout);
      script.remove();
      reject(new Error('Lecteur YouTube indisponible'));
    };
    const timeout = setTimeout(fail, 10000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timeout); resolve(window.YT); };
    script.onerror = fail;
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.append(script);
  }).catch(error => { api = undefined; throw error; });
  return api;
}

export function embedYouTube(container, id, events) {
  let player;
  let closed = false;
  let ready = false;
  let wantsPlayback = true;
  let manual = false;
  let started = false;
  const prompt = () => events.prompt({manual});
  const pause = () => {
    wantsPlayback = false;
    if (ready) player.pauseVideo();
  };
  const background = () => {
    const awaitingStart = wantsPlayback && !started;
    pause();
    if (awaitingStart) prompt();
    else events.paused();
  };
  const play = (fromControl = false) => {
    wantsPlayback = true;
    manual ||= fromControl;
    if (!ready) return;
    const {top, bottom, height} = container.getBoundingClientRect();
    const visible = Math.min(window.innerHeight, bottom) - Math.max(0, top);
    if (document.hidden || visible <= height / 2) {
      if (fromControl && !document.hidden) container.scrollIntoView({block: 'nearest'});
      prompt();
      return;
    }
    player.playVideo();
  };
  const timeout = setTimeout(() => { if (!closed) events.error(); }, 15000);
  container.hidden = false;
  loadAPI().then(YT => {
    if (closed) return;
    const iframe = document.createElement('iframe');
    const params = new URLSearchParams({enablejsapi: '1', origin: location.origin, playsinline: '1'});
    iframe.src = 'https://www.youtube.com/embed/' + encodeURIComponent(id) + '?' + params;
    iframe.title = 'Lecteur YouTube';
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    iframe.allowFullscreen = true;
    container.replaceChildren(iframe);
    player = new YT.Player(iframe, {
      events: {
        onReady: () => {
          if (closed) return;
          clearTimeout(timeout);
          ready = true;
          events.ready();
          if (wantsPlayback) play();
        },
        onStateChange: ({data}) => {
          if (closed || !ready) return;
          if (data === YT.PlayerState.PLAYING) {
            if (document.hidden) {
              background();
              return;
            }
            started = true;
            wantsPlayback = true;
            events.playing();
          }
          if (data === YT.PlayerState.PAUSED) events.paused();
          if (data === YT.PlayerState.ENDED) events.ended();
        },
        onAutoplayBlocked: () => { if (!closed && wantsPlayback) prompt(); },
        onError: () => { if (!closed) events.error(); },
      },
    });
  }).catch(() => { if (!closed) events.error(); });
  return {
    play,
    pause,
    background,
    seek: time => { if (ready) player.seekTo(time, true); },
    time: () => ready ? player.getCurrentTime() : 0,
    duration: () => ready ? player.getDuration() : 0,
    close() {
      closed = true;
      clearTimeout(timeout);
      player?.destroy();
      container.replaceChildren();
      container.hidden = true;
    },
  };
}
