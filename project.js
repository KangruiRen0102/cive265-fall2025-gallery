import {
  projectIds,
  titleFor,
  sourceImage,
  sourceGraph,
  existing,
  filePath,
} from './collection-files.js';
const $ = (id) => document.getElementById(id);
const fileSize = (bytes) =>
  bytes < 1_000_000
    ? `${Math.max(1, Math.ceil(bytes / 1000))} kB`
    : `${(bytes / 1_000_000).toLocaleString('en', { maximumFractionDigits: 1 })} MB`;
async function init() {
  const id = new URLSearchParams(location.search).get('model');
  if (!(await projectIds()).includes(id))
    throw new Error('This project is not in the collection.');
  const title = await titleFor(id);
  $('project-title').textContent = title;
  document.title = `${title} · CIV E 265`;
  $('project-id').textContent = `Project ${id}`;
  $('art').alt = `Submitted image for ${title}`;
  sourceImage($('art'), id, $('open-image'));
  $('details').hidden = false;
  sourceGraph(id).then((path) => {
    if (path) {
      $('dyn').href = path;
      $('dyn').download = id + '.dyn';
      $('dyn').hidden = false;
    }
  });
  const glb = filePath('verified-models', `${id}.glb`);
  existing(glb).then((res) => {
    if (res) {
      $('model-note').textContent = 'Explore the reviewed colour model.';
      setupViewer(
        { path: glb, bytes: Number(res.headers.get('Content-Length')) || null },
        true,
      );
    } else {
      $('model-note').textContent =
        'The original image shows the submitted design and materials. The optional archived STL is monochrome and may omit or misplace components.';
      setupViewer({ path: filePath('models', `${id}.stl`), up: 'y' }, false);
    }
  });
  try {
    const statement = await fetch(
      filePath('descriptions', `${id}_description.txt`),
    );
    if (!statement.ok) throw new Error();
    const raw = (await statement.text()).trim().replaceAll('\\n', '\n');
    for (const paragraph of raw.split(/\n\s*\n/)) {
      const p = document.createElement('p');
      p.textContent = paragraph;
      $('statement').append(p);
    }
  } catch {
    $('statement').textContent = 'The project statement could not be loaded.';
  }
}

function setupViewer(file, color) {
  const button = $('load');
  const initial =
    (color ? 'View colour model' : 'Open archived geometry') +
    (file.bytes ? ` (${fileSize(file.bytes)})` : '');
  button.hidden = false;
  button.textContent = initial;
  let controller,
    scene,
    generation = 0;
  function close() {
    generation++;
    controller?.abort();
    scene?.dispose();
    scene = null;
    $('zoom-in').disabled = $('zoom-out').disabled = true;
    $('viewport').replaceChildren();
    $('viewport').hidden = true;
    $('controls').hidden = true;
    button.textContent = initial;
    button.hidden = false;
    $('progress').textContent = '';
    button.focus();
  }
  $('close-view').onclick = close;
  $('reset').onclick = () => scene?.reset();
  $('zoom-in').onclick = () => scene?.zoom(1.25);
  $('zoom-out').onclick = () => scene?.zoom(0.8);
  button.onclick = async () => {
    const run = ++generation;
    controller = new AbortController();
    const signal = controller.signal;
    button.hidden = true;
    $('controls').hidden = false;
    $('reset').hidden = true;
    $('close-view').focus();
    $('progress').textContent = 'Loading 3D viewer…';
    try {
      const { openModel } = await import('./model-view.js');
      signal.throwIfAborted();
      const result = await openModel({
        viewport: $('viewport'),
        file,
        color,
        signal,
        report: (text) => {
          if (run === generation) $('progress').textContent = text;
        },
      });
      if (run !== generation) {
        result.dispose();
        return;
      }
      scene = result;
      $('zoom-in').disabled = $('zoom-out').disabled = false;
      $('progress').textContent = '';
      $('reset').hidden = false;
      $('viewport').focus();
    } catch (error) {
      if (run !== generation) return;
      close();
      $('progress').textContent =
        error.message ||
        'Unable to load this model. The project image remains available.';
    }
  };
  window.addEventListener('pagehide', close, { once: true });
}
init().catch((error) => {
  $('project-title').textContent = 'Project unavailable';
  $('error').textContent = error.message;
});
