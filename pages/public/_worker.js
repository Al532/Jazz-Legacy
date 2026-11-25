export default {
  fetch(request, env) {
    return env.JAZZ_LEGACY.fetch(request);
  },
};
