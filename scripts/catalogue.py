"""Manage the Windows catalogue and publish complete releases to R2."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import uuid


VIDEO_ID = re.compile(r'[A-Za-z0-9_-]{11}\Z')
AUDIO_NAME = re.compile(r'\[([A-Za-z0-9_-]{11})\]\.mp3\Z', re.I)
IMAGE_TYPES = {'.jpg', '.jpeg', '.png', '.webp', '.avif'}
PREFIX = 'jazz-legacy/'
ROOT = Path(__file__).resolve().parents[2]


def read(path, default=None):
    if default is not None and not path.exists():
        return default
    return json.loads(path.read_text(encoding='utf-8-sig'))


def encode(data):
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def save(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False, suffix='.tmp') as temp:
        temp.write(json.dumps(data, ensure_ascii=False, indent=2).encode() + b'\n')
    os.replace(temp.name, path)


def rclone(*args, allow_missing=False):
    config = Path(os.environ['APPDATA']) / 'rclone' / 'heads-audio.conf'
    result = subprocess.run(['rclone', '--config', str(config), '--s3-no-check-bucket', *args],
                            stdout=subprocess.PIPE, check=False)
    if result.returncode == 4 and allow_missing:
        return b''
    result.check_returncode()
    return result.stdout


def remote(key):
    return 'r2:heads-audio/' + key


def prepare(root, catalogue):
    title = input('Titre du standard à ajouter ou compléter : ').strip()
    if not title:
        raise ValueError('Le titre est obligatoire.')
    standards = catalogue['standards']
    matches = [row for row in standards if title.casefold() in
               [value.casefold() for value in [row['title'], *row.get('aliases', [])]]]
    if len(matches) > 1:
        raise ValueError('Titre ambigu. Utilisez un titre distinctif dans le catalogue maître.')
    standard = matches[0] if matches else None
    if standard is None:
        identifier = input('Identifiant permanent du standard (lettres, chiffres, tirets) : ').strip()
        if not re.fullmatch(r'[a-z0-9-]{1,80}', identifier) or any(row['id'] == identifier for row in standards):
            raise ValueError('Identifiant invalide ou déjà utilisé.')
        standard = {'id': identifier, 'title': title, 'composer': input('Compositeur (facultatif) : ').strip(), 'versions': []}
    artist = input('Artiste (laisser vide pour ajouter seulement le standard) : ').strip()
    if artist:
        video = input('Identifiant YouTube (11 caractères, facultatif) : ').strip()
        if video and not VIDEO_ID.fullmatch(video):
            raise ValueError('Identifiant YouTube invalide.')
        if video and any(row.get('youtube') == video for row in standard['versions']):
            raise ValueError('Cet identifiant est déjà associé à ce standard.')
        year = input('Année (facultatif) : ').strip()
        if year and not re.fullmatch(r'\d{4}', year):
            raise ValueError('Année invalide.')
        version = {'artist': artist, 'album': input('Album (facultatif) : ').strip()}
        if year:
            version['year'] = int(year)
        if video:
            version['youtube'] = video
            candidates = [path.name for path in (root / 'audio').glob('*.mp3')
                          if path.name.endswith(f'[{video}].mp3')]
            if candidates:
                print('MP3 correspondant : ' + ', '.join(candidates))
            elif input('MP3 attendu avant publication ? [o/N] ').casefold() == 'o':
                version['mp3Required'] = True
            cover = input('Nom de la jaquette confirmée dans jaquettes/images (facultatif) : ').strip()
            if cover:
                image(root / 'jaquettes/images', cover)
                version['coverFile'] = cover
        else:
            version['id'] = uuid.uuid4().hex
        standard['versions'].append(version)
    elif matches:
        return
    if not matches:
        standards.append(standard)
    save(root / 'catalogue-local/catalogue-data.json', catalogue)
    print('Catalogue maître enregistré.')


def image(folder, name):
    path = folder / name
    if (not re.fullmatch(r'[A-Za-z0-9][\w.-]*', name, re.ASCII)
            or path.suffix.lower() not in IMAGE_TYPES or not path.is_file()):
        raise ValueError(f'Jaquette manquante ou invalide : {path}')
    return path


def inventories(root, catalogue):
    covers = read(root / 'catalogue-local/recording-covers.json', {})
    thumbnails = read(root / 'jaquettes/miniatures-youtube/index.json', {'miniatures': []})
    thumbnails = {row['youtube']: row['fichier'] for row in thumbnails['miniatures'] if row.get('fichier')}
    audio = {}
    for path in sorted((root / 'audio').glob('*.mp3')):
        match = AUDIO_NAME.search(path.name)
        if not match:
            print(f'MP3 non associé : {path.name}')
            continue
        video = match[1]
        if video in audio:
            raise ValueError(f'Plusieurs MP3 pour {video}.')
        audio[video] = path
    selected_audio, selected_covers, standards = {}, {}, set()
    for row in catalogue['standards']:
        if not row['id'] or row['id'] in standards:
            raise ValueError(f'Identifiant de standard invalide ou dupliqué : {row["id"]}')
        standards.add(row['id'])
        for version in row['versions']:
            video = version.get('youtube')
            required = version.pop('mp3Required', False)
            confirmed = version.pop('coverFile', None)
            if not video:
                if required or confirmed:
                    raise ValueError(f'Média sans identifiant YouTube : {row["title"]}')
                continue
            if not VIDEO_ID.fullmatch(video):
                raise ValueError(f'Identifiant YouTube invalide : {video}')
            if video in audio:
                selected_audio[video] = audio[video]
            elif required:
                raise ValueError(f'MP3 requis mais absent : {video}')
            cover = confirmed or covers.get(video)
            if cover:
                candidate = image(root / 'jaquettes/images', cover)
                if video in selected_covers and selected_covers[video] != candidate:
                    raise ValueError(f'Jaquettes contradictoires pour {video}.')
                selected_covers[video] = candidate
    for video in {version.get('youtube') for row in catalogue['standards'] for version in row['versions']}:
        if video in thumbnails and video not in selected_covers:
            selected_covers[video] = image(root / 'jaquettes/miniatures-youtube', thumbnails[video])
    return selected_audio, selected_covers


def file_hash(path, algorithm):
    with path.open('rb') as source:
        return hashlib.file_digest(source, algorithm).hexdigest()


def remote_md5(item):
    return next((value.lower() for name, value in item.get('Hashes', {}).items()
                 if name.lower() == 'md5'), '')


def stage_media(root, stage, selected, listing):
    assets = {}
    for video, path in selected.items():
        old_key = path.relative_to(root).as_posix() if path.suffix.lower() != '.mp3' else path.name
        old = listing.get(old_key, {})
        md5 = file_hash(path, 'md5')
        if remote_md5(old) == md5 and old.get('Size') == path.stat().st_size:
            assets[video] = old_key
            continue
        digest = file_hash(path, 'sha256')
        name = digest + path.suffix.lower()
        key = PREFIX + 'media/' + name
        assets[video] = key
        if key in listing and remote_md5(listing[key]) == md5:
            continue
        destination = stage / name
        if not destination.exists():
            shutil.copyfile(path, destination)
            if file_hash(destination, 'sha256') != digest:
                raise ValueError(f'Fichier modifié pendant la préparation : {path}')
    return assets


def activation(initial, pointer):
    current = rclone('cat', remote(PREFIX + 'current.json'), allow_missing=True)
    if current != initial:
        raise ValueError('Le catalogue actif a changé pendant le transfert. Relancez la commande.')
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / 'current.json'
        path.write_bytes(encode(pointer))
        rclone('copyto', str(path), remote(PREFIX + 'current.json'), '--ignore-times')
    if rclone('cat', remote(PREFIX + 'current.json')) != encode(pointer):
        raise ValueError('Activation non confirmée.')


def publish(root, catalogue):
    audio, covers = inventories(root, catalogue)
    print(f'{len(catalogue["standards"])} standards, {len(audio)} MP3 et {len(covers)} jaquettes ou miniatures.')
    loudness = read(root / 'audio/loudness.json', {})
    items = read(root / 'catalogue-local/ajouts-partages.json', [])
    initial = rclone('cat', remote(PREFIX + 'current.json'), allow_missing=True)
    previous = json.loads(initial)['release'] if initial else None
    listing = {row['Path']: row for row in json.loads(rclone(
        'lsjson', remote(''), '-R', '--files-only', '--hash', '--use-server-modtime'))}
    with tempfile.TemporaryDirectory(dir=root / 'catalogue-local') as temporary:
        stage = Path(temporary) / 'media'
        stage.mkdir()
        data = {'catalogue': catalogue, 'audio': stage_media(root, stage, audio, listing),
                'covers': stage_media(root, stage, covers, listing), 'loudness': loudness, 'items': items}
        body = encode(data)
        edition = hashlib.sha256(body).hexdigest()
        if previous == edition:
            print('Le catalogue actif est déjà à jour.')
            return
        if previous:
            old = json.loads(rclone('cat', remote(PREFIX + 'releases/' + previous + '.json')))
            old_standards = {row['id']: row for row in old['catalogue']['standards']}
        else:
            old_standards = {}
        changed = [row['title'] for row in catalogue['standards'] if old_standards.pop(row['id'], None) != row]
        for title in changed[:20]:
            print(f'  + {title}')
        if old_standards:
            print('Standards retirés : ' + ', '.join(row['title'] for row in old_standards.values()))
        print(f'{len(changed)} fiches nouvelles ou modifiées, {len(list(stage.iterdir()))} médias à transférer.')
        if input('Activer cette édition en ligne ? [o/N] ').strip().casefold() != 'o':
            return
        if any(stage.iterdir()):
            rclone('copy', str(stage), remote(PREFIX + 'media'), '--immutable')
            rclone('check', str(stage), remote(PREFIX + 'media'), '--one-way', '--download')
        file = Path(temporary) / 'release.json'
        file.write_bytes(body)
        key = remote(PREFIX + 'releases/' + edition + '.json')
        rclone('copyto', str(file), key, '--immutable')
        if rclone('cat', key) != body:
            raise ValueError('Le catalogue transféré diffère du fichier local.')
        activation(initial, {'release': edition, 'previous': previous})
        print('Édition active : ' + edition)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['preparer', 'verifier', 'publier', 'retablir'])
    parser.add_argument('--dossier', type=Path, default=ROOT)
    args = parser.parse_args()
    root = args.dossier.resolve()
    catalogue = read(root / 'catalogue-local/catalogue-data.json')
    if args.action == 'preparer':
        prepare(root, catalogue)
    elif args.action == 'verifier':
        audio, covers = inventories(root, catalogue)
        print(f'{len(catalogue["standards"])} standards, {len(audio)} MP3, {len(covers)} jaquettes ou miniatures.')
    elif args.action == 'publier':
        publish(root, catalogue)
    else:
        initial = rclone('cat', remote(PREFIX + 'current.json'))
        pointer = json.loads(initial)
        previous = pointer.get('previous')
        if not previous or not re.fullmatch(r'[0-9a-f]{64}', previous):
            raise ValueError('Aucune édition précédente enregistrée.')
        data = rclone('cat', remote(PREFIX + 'releases/' + previous + '.json'))
        if hashlib.sha256(data).hexdigest() != previous:
            raise ValueError('Édition précédente non vérifiée.')
        if input(f'Rétablir {previous[:12]} ? [o/N] ').casefold() == 'o':
            activation(initial, {'release': previous, 'previous': pointer['release']})


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
