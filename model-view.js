const scripts = new Map();
function loadScript(src) {
  if (!scripts.has(src))
    scripts.set(
      src,
      new Promise((resolve, reject) => {
        const tag = document.createElement('script');
        tag.src = src;
        tag.onload = resolve;
        tag.onerror = () => {
          tag.remove();
          scripts.delete(src);
          reject(new Error('The 3D library could not be loaded.'));
        };
        document.head.append(tag);
      }),
    );
  return scripts.get(src);
}
function stlMesh(file, signal, report) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('stl-worker.js');
    const stop = () => {
      worker.terminate();
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      stop();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => {
      stop();
      reject(new Error('The STL could not be read.'));
    };
    worker.onmessage = ({ data }) => {
      if ('received' in data) {
        report(`Downloading geometry · ${(data.received / 1e6).toFixed(1)} MB`);
        return;
      }
      if ('percent' in data) {
        report(
          data.percent < 100
            ? `Downloading geometry · ${data.percent}%`
            : 'Preparing geometry…',
        );
        return;
      }
      stop();
      if (data.error) {
        reject(new Error(data.error));
        return;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(data.positions), 3),
      );
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: 0xc2c6bf,
          roughness: 0.83,
          side: THREE.DoubleSide,
        }),
      );
      if (file.up === 'z') mesh.rotation.x = -Math.PI / 2;
      resolve(mesh);
    };
    if (file.localFile) {
      worker.postMessage({ localFile: file.localFile, size: file.bytes });
      return;
    }
    const path = file.path.split('/').map(encodeURIComponent).join('/');
    worker.postMessage({
      local: new URL(path, location.href).href,
      remote: `https://media.githubusercontent.com/media/KangruiRen0102/cive265-fall2025-gallery/main/${path}`,
      size: file.bytes,
    });
  });
}
function requireEmbeddedGlb(data) {
  const view = new DataView(data);
  if (
    data.byteLength < 20 ||
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== data.byteLength ||
    view.getUint32(16, true) !== 0x4e4f534a
  )
    throw new Error('Choose a complete binary glTF 2.0 (.glb) file.');
  const length = view.getUint32(12, true);
  if (length > data.byteLength - 20)
    throw new Error('The GLB header is incomplete.');
  const doc = JSON.parse(
    new TextDecoder().decode(new Uint8Array(data, 20, length)),
  );
  const assets = [...(doc.buffers || []), ...(doc.images || [])];
  if (assets.some((asset) => asset.uri && !asset.uri.startsWith('data:')))
    throw new Error(
      'This GLB references external files. Export geometry and materials in one self-contained GLB.',
    );
}
function freeObject(object) {
  object?.traverse((child) => {
    child.geometry?.dispose();
    const mats = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const m of mats) {
      if (!m) continue;
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}
export async function openModel({ viewport, file, color, signal, report }) {
  let renderer, object, controls, observer, cpuScene;
  const dispose = () => {
    cpuScene?.dispose();
    observer?.disconnect();
    controls?.dispose();
    freeObject(object);
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
    viewport.removeEventListener('keydown', onKey);
  };
  let camera, centre, radius, reset;
  function onKey(event) {
    const keys = [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      '+',
      '=',
      '-',
      '_',
      'Home',
    ];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') {
      reset();
      return;
    }
    const offset = new THREE.Spherical().setFromVector3(
      camera.position.clone().sub(controls.target),
    );
    if (event.key === 'ArrowLeft') offset.theta -= 0.13;
    if (event.key === 'ArrowRight') offset.theta += 0.13;
    if (event.key === 'ArrowUp') offset.phi -= 0.12;
    if (event.key === 'ArrowDown') offset.phi += 0.12;
    if (['+', '='].includes(event.key)) offset.radius *= 0.82;
    if (['-', '_'].includes(event.key)) offset.radius /= 0.82;
    offset.makeSafe();
    offset.radius = THREE.MathUtils.clamp(
      offset.radius,
      controls.minDistance,
      controls.maxDistance,
    );
    camera.position.setFromSpherical(offset).add(controls.target);
    controls.update();
  }
  try {
    await loadScript('js/three.min.js');
    await Promise.all([
      loadScript('js/OrbitControls.js'),
      ...(color ? [loadScript('js/GLTFLoader.js')] : []),
    ]);
    signal.throwIfAborted();
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      await loadScript('cpu-preview.js');
    }
    signal.throwIfAborted();
    if (color) {
      report(
        file.localFile ? 'Reading colour model…' : 'Downloading colour model…',
      );
      let data;
      if (file.localFile) data = await file.localFile.arrayBuffer();
      else {
        const res = await fetch(file.path, { signal });
        if (!res.ok)
          throw new Error('The colour model could not be downloaded.');
        data = await res.arrayBuffer();
      }
      signal.throwIfAborted();
      requireEmbeddedGlb(data);
      if (file.bytes && data.byteLength !== file.bytes)
        throw new Error('The colour model download was incomplete.');
      report('Preparing materials…');
      object = await new Promise((resolve, reject) =>
        new THREE.GLTFLoader(
          new THREE.LoadingManager().setURLModifier((url) => {
            if (!/^(?:data:|blob:)/i.test(url))
              throw new Error('GLB contains an external resource.');
            return url;
          }),
        ).parse(
          data,
          '',
          (gltf) => resolve(gltf.scene),
          () => reject(new Error('The colour model could not be read.')),
        ),
      );
    } else {
      object = await stlMesh(file, signal, report);
    }
    signal.throwIfAborted();
    if (!renderer) {
      viewport.hidden = false;
      cpuScene = window.PavilionCanvasPreview.mount(viewport, object, {
        THREE,
        up: 'Y',
        label: 'Interactive model',
      });
      return {
        dispose,
        reset: () => cpuScene.reset(),
        zoom: (factor) => cpuScene.zoom(factor),
      };
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xedf0eb);
    scene.add(object);
    const box = new THREE.Box3().setFromObject(object),
      sphere = box.getBoundingSphere(new THREE.Sphere());
    centre = sphere.center;
    radius = sphere.radius;
    if (!Number.isFinite(radius) || radius <= 0)
      throw new Error('The model has no visible geometry.');
    camera = new THREE.PerspectiveCamera(40, 1, radius * 0.0005, radius * 100);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xe3e6df, 0.97));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(3, 6, 4);
    scene.add(sun);
    viewport.hidden = false;
    viewport.replaceChildren(renderer.domElement);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableKeys = false;
    controls.minDistance = radius * 0.03;
    controls.maxDistance = radius * 40;
    const draw = () => renderer.render(scene, camera);
    controls.addEventListener('change', draw);
    const resize = () => {
      const w = viewport.clientWidth,
        h = viewport.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      draw();
    };
    reset = () => {
      const vertical = (camera.fov * Math.PI) / 360;
      const angle = Math.min(
        vertical,
        Math.atan(Math.tan(vertical) * camera.aspect),
      );
      const distance = (radius * 1.07) / Math.sin(angle);
      controls.target.copy(centre);
      camera.position
        .copy(
          new THREE.Vector3(1, 0.76, 1.08).normalize().multiplyScalar(distance),
        )
        .add(centre);
      controls.update();
      draw();
    };
    resize();
    reset();
    observer = new ResizeObserver(resize);
    observer.observe(viewport);
    viewport.addEventListener('keydown', onKey);
    function zoom(factor) {
      const offset = camera.position.clone().sub(controls.target);
      const distance = THREE.MathUtils.clamp(
        offset.length() / factor,
        controls.minDistance,
        controls.maxDistance,
      );
      camera.position.copy(offset.setLength(distance).add(controls.target));
      controls.update();
      draw();
    }
    return { dispose, reset, zoom };
  } catch (error) {
    dispose();
    throw error;
  }
}
