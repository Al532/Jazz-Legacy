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
  const play = (scroll = false) => {
    if (!ready) return;
    const {top, bottom, height} = container.getBoundingClientRect();
    const visible = Math.min(window.innerHeight, bottom) - Math.max(0, top);
    if (document.hidden || !height || visible < height / 2) {
      events.prompt();
      if (scroll && !document.hidden) container.scrollIntoView({block: 'nearest'});
      return;
    }
    player.playVideo();
  };
  const timeout = setTimeout(() => { if (!closed) events.error(); }, 15000);
  container.hidden = false;
  loadAPI().then(YT => {
    if (closed) return;
    const mount = document.createElement('div');
    container.replaceChildren(mount);
    player = new YT.Player(mount, {
      videoId: id,
      playerVars: {origin: location.origin, playsinline: 1},
      events: {
        onReady: () => {
          if (closed) return;
          clearTimeout(timeout);
          ready = true;
          events.ready();
          play();
        },
        onStateChange: ({data}) => {
          if (closed || !ready) return;
          if (data === YT.PlayerState.PLAYING) events.playing();
          if (data === YT.PlayerState.PAUSED) events.paused();
          if (data === YT.PlayerState.ENDED) events.ended();
        },
        onAutoplayBlocked: () => { if (!closed) events.prompt(); },
        onError: () => { if (!closed) events.error(); },
      },
    });
  }).catch(() => { if (!closed) events.error(); });
  return {
    play,
    pause: () => { if (ready) player.pauseVideo(); },
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
