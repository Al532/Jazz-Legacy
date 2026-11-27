import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedYouTubeInput, suggestYouTubeMetadata} from '../public/youtube-import.mjs';
import {suggestStandard} from '../public/listening.mjs';

const watch = 'https://www.youtube.com/watch?v=khby51sf82s';

test('normalizes the shared video link before filling the import form', () => {
  assert.equal(sharedYouTubeInput(new URLSearchParams({url: watch})), watch);
  assert.equal(sharedYouTubeInput(new URLSearchParams({
    title: 'Freddie Hubbard - Up Jumped Spring',
    text: 'Freddie Hubbard – Up Jumped Spring\nhttps://youtu.be/khby51sf82s?si=abc',
  })), watch);
  assert.equal(sharedYouTubeInput(new URLSearchParams({
    url: watch,
    title: 'Freddie Hubbard - Up Jumped Spring',
  })), watch);
  assert.equal(sharedYouTubeInput(new URLSearchParams({text: watch + '\nFreddie Hubbard - Up Jumped Spring'})), watch);
  assert.equal(sharedYouTubeInput(new URLSearchParams({url: 'https://example.com', text: '🎵 ' + watch})), watch);
  assert.equal(sharedYouTubeInput(new URLSearchParams({text: 'Aucun lien'})), 'Aucun lien');
});

test('imports the recording title and performer instead of the uploader', () => {
  const metadata = suggestYouTubeMetadata('Freddie Hubbard - Up Jumped Spring', 'ropa1979', []);
  assert.deepEqual(metadata, {name: 'Up Jumped Spring', artist: 'Freddie Hubbard'});
  const standard = {id: 'upjumpedspring', title: 'Up Jumped Spring'};
  assert.equal(suggestStandard(metadata.name, [standard]), standard);
});

test('recognizes catalogue artists in either order and retains the ensemble credit', () => {
  const catalogue = [{versions: [{artist: 'Tete Montoliu Trio'}]}];
  assert.deepEqual(suggestYouTubeMetadata('Autumn Leaves — Tété Montoliu Trio', 'Archives', catalogue),
    {name: 'Autumn Leaves', artist: 'Tete Montoliu Trio'});
  assert.deepEqual(suggestYouTubeMetadata('The Bill Evans Trio: Waltz for Debby (Official Audio)', 'Archives', []),
    {name: 'Waltz for Debby', artist: 'The Bill Evans Trio'});
});

test('uses a Topic credit but leaves an unrecognized channel out of the artist field', () => {
  assert.deepEqual(suggestYouTubeMetadata('Blue Bossa', 'Kenny Dorham - Topic', []),
    {name: 'Blue Bossa', artist: 'Kenny Dorham'});
  assert.deepEqual(suggestYouTubeMetadata('Blue Bossa', 'Vintage Jazz Uploads', []),
    {name: 'Blue Bossa', artist: ''});
});
