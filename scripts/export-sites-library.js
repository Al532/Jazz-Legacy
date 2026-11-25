// Run on the old Sites origin in the same browser that holds the guest library.
(() => {
  if (location.origin !== 'https://jazz-legacy.al5321.chatgpt.site') throw new Error('Ouvrir l’ancien Jazz Legacy.');
  const read = (key, fallback) => JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  const library = read('heads.catalogue.personal.v1', {});
  const data = {format: 'jazz-legacy-sites-backup-v1', library: {
    favorites: library.favorites || [], trackFavorites: library.trackFavorites || [],
  }, playlists: read('heads.playlists.v1', []), mode: read('jazz-legacy.mode', null)};
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
  link.download = 'jazz-legacy-bibliotheque.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
})();
