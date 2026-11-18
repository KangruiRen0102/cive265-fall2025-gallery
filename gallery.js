import { projectIds, sourceImage, titleFor } from './collection-files.js';
const $ = (id) => document.getElementById(id);
const pageSize = 24;
let projects = [];
const titles = new Map(),
  loading = new Map();
let revision = 0,
  active = 0,
  searchTimer;
const queue = [];
function title(id) {
  if (titles.has(id)) return Promise.resolve(titles.get(id));
  if (loading.has(id)) return loading.get(id);
  const task = new Promise((resolve) =>
    queue.push(async () => {
      const value = await titleFor(id);
      titles.set(id, value);
      loading.delete(id);
      resolve(value);
    }),
  );
  loading.set(id, task);
  pump();
  return task;
}
function pump() {
  while (active < 5 && queue.length) {
    active++;
    queue
      .shift()()
      .finally(() => {
        active--;
        pump();
      });
  }
}

const initial = new URL(location.href).searchParams;
let page = Math.max(1, Number.parseInt(initial.get('page'), 10) || 1);
$('search').value = initial.get('q') || '';

function card(project) {
  const link = document.createElement('a');
  link.className = 'card';
  link.href = 'viewer.html?' + new URLSearchParams({ model: project });
  const tile = document.createElement('div');
  tile.className = 'tile';
  const image = new Image();
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  sourceImage(image, project);
  tile.append(image);
  const id = document.createElement('span');
  id.className = 'project-no';
  id.textContent = `Project ${project}`;
  const heading = document.createElement('h3');
  heading.textContent = titles.get(project) || `Project ${project}`;
  title(project).then((value) => {
    heading.textContent = value;
  });
  link.append(tile, id, heading);
  return link;
}

function render() {
  const term = $('search').value.trim().toLowerCase();
  const matches = projects.filter((id) =>
    (id + ' ' + (titles.get(id) || '')).toLowerCase().includes(term),
  );
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  page = Math.min(page, pages);
  const url = new URL(location.href);
  if (page > 1) url.searchParams.set('page', page);
  else url.searchParams.delete('page');
  if (term) url.searchParams.set('q', $('search').value.trim());
  else url.searchParams.delete('q');
  history.replaceState(null, '', url);
  $('count').textContent =
    `${matches.length} ${matches.length === 1 ? 'project' : 'projects'}`;
  $('cards').replaceChildren(
    ...matches.slice((page - 1) * pageSize, page * pageSize).map(card),
  );
  $('message').textContent = matches.length
    ? ''
    : 'No projects match this search.';
  $('paging').hidden = pages === 1;
  $('prev').disabled = page <= 1;
  $('next').disabled = page >= pages;
  $('page').textContent = `${page} / ${pages}`;
}

async function init() {
  projects = await projectIds();
  if (projects.length) {
    const featured = projects[0];
    $('featured').href =
      'viewer.html?' + new URLSearchParams({ model: featured });
    sourceImage($('featured-image'), featured);
    $('featured').hidden = false;
    title(featured).then((value) => {
      $('featured-title').textContent = value;
    });
  }
  async function search() {
    const current = ++revision;
    clearTimeout(searchTimer);
    render();
    const query = $('search').value.trim();
    if (!query || /^\d+$/.test(query) || titles.size === projects.length)
      return;
    $('message').textContent = 'Searching project titles…';
    searchTimer = setTimeout(async () => {
      // Only a textual search needs all titles. Five workers stop scheduling work when the query changes.
      const missing = projects.filter((id) => !titles.has(id));
      let index = 0;
      async function lookup() {
        while (current === revision && index < missing.length)
          await title(missing[index++]);
      }
      await Promise.all(Array.from({ length: 5 }, lookup));
      if (current === revision) render();
    }, 200);
  }
  search();
  $('search').oninput = () => {
    page = 1;
    search();
  };
  for (const [btn, delta] of [
    ['prev', -1],
    ['next', 1],
  ]) {
    $(btn).onclick = () => {
      page += delta;
      render();
      $('collection').scrollIntoView();
      $('cards').firstElementChild?.focus({ preventScroll: true });
    };
  }
}
init().catch(() => {
  $('count').textContent = 'Collection unavailable';
  $('message').textContent =
    'The project list could not be loaded. Please refresh the page.';
});
