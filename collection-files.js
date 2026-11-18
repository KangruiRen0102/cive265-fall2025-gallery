// Read the exhibition's existing public files directly. Path components must be encoded independently.
export function filePath(directory, name) {
  return `${directory}/${encodeURIComponent(name)}`;
}
export async function projectIds() {
  const response = await fetch('ids.txt');
  if (!response.ok) throw new Error('The collection could not be loaded.');
  return [
    ...new Set(
      (await response.text())
        .trim()
        .split(/\s+/)
        .filter((id) => /^[\w-]+$/.test(id)),
    ),
  ];
}
export async function titleFor(id) {
  try {
    const response = await fetch(filePath('titles', `${id}_title.txt`));
    if (response.ok) return (await response.text()).trim() || `Project ${id}`;
  } catch {}
  return `Project ${id}`;
}
export function sourceImage(image, id, link = null) {
  const extensions = ['png', 'jpg', 'jpeg', 'webp', 'PNG', 'JPG'];
  let index = 0;
  function next() {
    if (index === extensions.length) {
      image.removeAttribute('src');
      if (link) link.removeAttribute('href');
      return;
    }
    const src = filePath('thumbnails', `${id}.${extensions[index++]}`);
    image.src = src;
    if (link) link.href = src;
  }
  image.onerror = next;
  next();
}
export async function existing(path) {
  try {
    const response = await fetch(path, { method: 'HEAD' });
    return response.ok &&
      !/text\/html/i.test(response.headers.get('Content-Type') || '')
      ? response
      : null;
  } catch {
    return null;
  }
}
export async function sourceGraph(id) {
  for (const suffix of ['.dyn', '.dyn.dyn', '#.dyn', '(1).dyn', ' .dyn']) {
    const path = filePath('dyn', `${id}${suffix}`);
    if (await existing(path)) return path;
  }
  return null;
}
