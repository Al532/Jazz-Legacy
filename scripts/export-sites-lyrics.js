// Run on the old site while signed into the Sites account that owns the lyrics.
(async () => {
  if (location.origin !== 'https://jazz-legacy.al5321.chatgpt.site') throw new Error('Ouvrir l’ancien Jazz Legacy.');
  const {standards} = await (await fetch('/catalogue-data.json', {cache: 'no-store'})).json();
  const lyrics = {};
  for (let index = 0; index < standards.length; index += 6) {
    await Promise.all(standards.slice(index, index + 6).map(async ({id}) => {
      const response = await fetch('/api/lyrics/' + encodeURIComponent(id), {cache: 'no-store'});
      if (!response.ok) throw new Error('Les paroles ne sont pas accessibles.');
      const result = await response.json();
      if (result.signIn) throw new Error('Connecte-toi à l’ancien site pour lire tes paroles.');
      if (result.text) lyrics[id] = result.text;
    }));
  }
  const data = {format: 'jazz-legacy-sites-backup-v1', library: {}, lyrics};
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'}));
  link.download = 'jazz-legacy-paroles-privees.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
})();
