import { openModel } from './model-view.js';
const $ = (id) => document.getElementById(id);
let controller,
  scene,
  revision = 0;
function release() {
  revision++;
  controller?.abort();
  scene?.dispose();
  scene = null;
  $('zoom-in').disabled = $('zoom-out').disabled = true;
  $('viewport').replaceChildren();
  $('viewport').hidden = true;
  $('controls').hidden = true;
}
async function load(example = false) {
  release();
  const run = revision;
  const file = example
    ? { name: 'Course material sample.glb', size: 7584 }
    : $('file').files[0];
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  $('axis-row').hidden = ext !== 'stl';
  if (!['glb', 'stl'].includes(ext) || !file.size) {
    $('progress').textContent = 'Choose a nonempty .glb or .stl file.';
    return;
  }
  controller = new AbortController();
  $('progress').textContent = 'Opening ' + file.name + '…';
  $('controls').hidden = false;
  $('reset').disabled = true;
  try {
    const result = await openModel({
      viewport: $('viewport'),
      file: example
        ? { path: 'examples/material-sample.glb', bytes: file.size }
        : { localFile: file, bytes: file.size, up: $('axis').value },
      color: ext === 'glb',
      signal: controller.signal,
      report: (msg) => {
        if (revision === run) $('progress').textContent = msg;
      },
    });
    if (revision !== run) {
      result.dispose();
      return;
    }
    scene = result;
    $('zoom-in').disabled = $('zoom-out').disabled = false;
    $('progress').textContent = file.name;
    $('reset').disabled = false;
    $('viewport').focus();
  } catch (error) {
    if (revision === run) {
      release();
      $('progress').textContent =
        error.message || 'This file could not be opened.';
    }
  }
}
$('file').onchange = () => load();
$('axis').onchange = () => load();
$('sample').onclick = () => {
  $('file').value = '';
  load(true);
};
$('reset').onclick = () => scene?.reset();
$('zoom-in').onclick = () => scene?.zoom(1.25);
$('zoom-out').onclick = () => scene?.zoom(0.8);
$('clear').onclick = () => {
  release();
  $('file').value = '';
  $('axis-row').hidden = true;
  $('progress').textContent = '';
  $('file').focus();
};
window.addEventListener('pagehide', release);
