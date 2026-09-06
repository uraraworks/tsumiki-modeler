import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createToonMaterial, createOutlineMaterial } from './materials.js';
export function createViewport(container, host, onSelect, onTransformCommit, onTransformPreview) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(384, 216, false);
  renderer.setClearColor('#242e39');
  host.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', '3Dモデル。ドラッグで回転、クリックでパーツを選択');
  const camera = new THREE.PerspectiveCamera(38, 384 / 216, 0.1, 100000);
  camera.position.set(18, 16, 23);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 6, 0);
  controls.minDistance = 2;
  controls.maxDistance = 50000;
  controls.update();
  let scene, pickable = [];
  const render = () => { if (scene) renderer.render(scene, camera); };
  controls.addEventListener('change', render);
  const transformControls = new TransformControls(camera, renderer.domElement);
  const transformHelper = transformControls.getHelper();
  transformControls.setMode('translate');
  transformControls.setTranslationSnap(1);
  transformControls.setRotationSnap(THREE.MathUtils.degToRad(15));
  transformControls.addEventListener('change', render);
  const normalizeDegrees = radians => ((Math.round(THREE.MathUtils.radToDeg(radians)) % 360) + 360) % 360;
  const readTransform = (object, mode) => mode === 'rotate'
    ? { rotation: object.rotation.toArray().slice(0, 3).map(normalizeDegrees) }
    : { position: object.position.toArray().map(Math.round) };
  let dragStart = null;
  transformControls.addEventListener('dragging-changed', event => {
    controls.enabled = !event.value;
    if (event.value) {
      const object = transformControls.object;
      const mode = transformControls.getMode();
      dragStart = object ? { partId: object.userData.partId, mode, transform: readTransform(object, mode) } : null;
      return;
    }
    const object = transformControls.object, finished = dragStart;
    dragStart = null;
    if (!object || !finished || object.userData.partId !== finished.partId) return;
    const transform = readTransform(object, finished.mode);
    if (transform.position) object.position.fromArray(transform.position);
    else object.rotation.set(...transform.rotation.map(THREE.MathUtils.degToRad));
    const key = Object.keys(transform)[0];
    if (transform[key].some((value, index) => value !== finished.transform[key][index])) onTransformCommit(finished.partId, transform);
  });
  transformControls.addEventListener('objectChange', () => {
    const object = transformControls.object;
    if (object) onTransformPreview(object.userData.partId, readTransform(object, transformControls.getMode()));
  });
  // 編集のたびにドキュメントから再構築し、古いGPU資源を解放する。
  function rebuild(doc, selectedId) {
    if (scene) {
      // ギズモのGPU資源は再利用するため、旧シーンの破棄対象から外す。
      transformControls.detach();
      scene.remove(transformHelper);
      const geometries = new Set(), materials = new Set();
      scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => materials.add(m));
      });
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    }
    scene = new THREE.Scene(); pickable = [];
    const light = new THREE.DirectionalLight('#ffffff', 1);
    light.position.set(-3, 8, 5);
    const ambient = new THREE.AmbientLight('#ffffff', 0.18);
    scene.add(light, ambient);
    scene.add(new THREE.GridHelper(40 * doc.grid, 40, '#687988', '#3b4a57'));
    let selectedMesh = null;
    for (const part of doc.parts) {
      const geometry = part.type === 'box' ? new THREE.BoxGeometry(...part.size) : new THREE.CylinderGeometry(part.radius, part.radius, part.height, part.segments, 1);
      const mesh = new THREE.Mesh(geometry, createToonMaterial(part.color, light, ambient));
      mesh.position.fromArray(part.position);
      mesh.rotation.set(...part.rotation.map(THREE.MathUtils.degToRad));
      mesh.userData.partId = part.id;
      const outline = new THREE.Mesh(geometry, createOutlineMaterial(part.id === selectedId));
      outline.userData.partId = part.id;
      mesh.add(outline); scene.add(mesh); pickable.push(mesh);
      if (part.id === selectedId) selectedMesh = mesh;
    }
    scene.add(transformHelper);
    if (selectedMesh) transformControls.attach(selectedMesh);
    else transformControls.detach();
    render();
  }
  const resize = () => {
    const scale = Math.max(1, Math.floor(Math.min(container.clientWidth / 384, container.clientHeight / 216)));
    renderer.domElement.style.width = `${384 * scale}px`;
    renderer.domElement.style.height = `${216 * scale}px`;
    document.querySelector('#resolution').textContent = `384 × 216 · ${scale}倍`;
    render();
  };
  new ResizeObserver(resize).observe(container);
  resize();
  const raycaster = new THREE.Raycaster();
  let start = null;
  renderer.domElement.addEventListener('pointerdown', event => {
    // TransformControls のリスナーが先に動くため、ギズモを掴んだクリックは選択判定に回さない。
    start = event.button === 0 && !transformControls.dragging ? { x: event.clientX, y: event.clientY, id: event.pointerId, dragged: false } : null;
  });
  renderer.domElement.addEventListener('pointermove', event => { if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) start.dragged = true; });
  renderer.domElement.addEventListener('pointercancel', () => { start = null; });
  renderer.domElement.addEventListener('pointerup', event => {
    const down = start; start = null;
    if (!down || down.id !== event.pointerId || down.dragged || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    onSelect(raycaster.intersectObjects(pickable, false)[0]?.object.userData.partId ?? null);
  });
  return {
    rebuild,
    setMode(mode) {
      if (!['translate', 'rotate'].includes(mode)) return;
      transformControls.setMode(mode);
      render();
    },
  };
}
