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
  let scene, pickable = [], mode = 'translate', selectedMesh = null, selectedPart = null, handleGroup = null, resizeHandles = [], resizeDrag = null, currentGrid = 1;
  const handleWorldPosition = new THREE.Vector3();
  const render = () => {
    if (!scene) return;
    scene.updateMatrixWorld(true);
    // 内部解像度上で約6pxに見えるワールド寸法へ毎フレーム換算する。
    for (const handle of resizeHandles) {
      handle.getWorldPosition(handleWorldPosition);
      const worldSize = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.position.distanceTo(handleWorldPosition) * 6 / 216;
      handle.scale.setScalar(worldSize);
    }
    renderer.render(scene, camera);
  };
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
  const axisVectors = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const axisColors = ['#ef5350', '#66bb6a', '#42a5f5'];
  function createResizeHandles(part, mesh) {
    handleGroup = new THREE.Group();
    handleGroup.position.copy(mesh.position);
    handleGroup.quaternion.copy(mesh.quaternion);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const materials = axisColors.map(color => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false }));
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const handle = new THREE.Mesh(geometry, materials[axis]);
      handle.renderOrder = 1000;
      handle.userData = { axis, sign };
      handleGroup.add(handle);
      resizeHandles.push(handle);
    }
    scene.add(handleGroup);
    updateHandleLayout(part.type === 'box' ? { size: part.size } : { radius: part.radius, height: part.height });
  }
  function updateHandleLayout(dimensions) {
    if (!handleGroup || !selectedMesh) return;
    handleGroup.position.copy(selectedMesh.position);
    handleGroup.quaternion.copy(selectedMesh.quaternion);
    for (const handle of resizeHandles) {
      const { axis, sign } = handle.userData;
      const extent = selectedPart.type === 'box' ? dimensions.size[axis] / 2 : axis === 1 ? dimensions.height / 2 : dimensions.radius;
      handle.position.copy(axisVectors[axis]).multiplyScalar(sign * extent);
    }
  }
  // 編集のたびにドキュメントから再構築し、古いGPU資源を解放する。
  function rebuild(doc, selectedId) {
    if (resizeDrag) finishResizeDrag(null, false);
    controls.enabled = true;
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
    scene = new THREE.Scene(); pickable = []; resizeHandles = []; handleGroup = null; selectedMesh = null; selectedPart = null; currentGrid = doc.grid;
    const light = new THREE.DirectionalLight('#ffffff', 1);
    light.position.set(-3, 8, 5);
    const ambient = new THREE.AmbientLight('#ffffff', 0.18);
    scene.add(light, ambient);
    scene.add(new THREE.GridHelper(40 * doc.grid, 40, '#687988', '#3b4a57'));
    for (const part of doc.parts) {
      const geometry = part.type === 'box' ? new THREE.BoxGeometry(...part.size) : new THREE.CylinderGeometry(part.radius, part.radius, part.height, part.segments, 1);
      const mesh = new THREE.Mesh(geometry, createToonMaterial(part.color, light, ambient));
      mesh.position.fromArray(part.position);
      mesh.rotation.set(...part.rotation.map(THREE.MathUtils.degToRad));
      mesh.userData.partId = part.id;
      const outline = new THREE.Mesh(geometry, createOutlineMaterial(part.id === selectedId));
      outline.userData.partId = part.id;
      mesh.add(outline); scene.add(mesh); pickable.push(mesh);
      if (part.id === selectedId) { selectedMesh = mesh; selectedPart = part; }
    }
    scene.add(transformHelper);
    if (selectedMesh && mode !== 'resize') transformControls.attach(selectedMesh);
    else transformControls.detach();
    if (selectedMesh && mode === 'resize') createResizeHandles(selectedPart, selectedMesh);
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
  const pointer = new THREE.Vector2();
  const setRayFromEvent = event => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  };
  const roundInteger = value => Math.sign(value) * Math.round(Math.abs(value));
  const sameTransform = (left, right) => Object.entries(left).every(([key, value]) => Array.isArray(value)
    ? value.every((item, index) => item === right[key][index])
    : value === right[key]);
  function originalResizeTransform(drag) {
    if (drag.part.type === 'box') return { position: [...drag.part.position], size: [...drag.part.size] };
    if (drag.axis === 1) return { position: [...drag.part.position], height: drag.part.height };
    return { radius: drag.part.radius };
  }
  function applyResizePreview(drag, snappedDelta) {
    const { axis, sign, part, mesh, worldAxis } = drag;
    let transform, dimensions;
    if (part.type === 'cylinder' && axis !== 1) {
      const radius = THREE.MathUtils.clamp(part.radius + sign * snappedDelta, 1, 10000);
      transform = { radius };
      dimensions = { radius, height: part.height };
      mesh.position.fromArray(part.position);
      mesh.scale.set(radius / part.radius, 1, radius / part.radius);
    } else {
      const originalExtent = part.type === 'box' ? part.size[axis] : part.height;
      const extent = THREE.MathUtils.clamp(originalExtent + sign * snappedDelta, 1, 10000);
      const effectiveDelta = sign * (extent - originalExtent);
      const position = new THREE.Vector3().fromArray(part.position).addScaledVector(worldAxis, effectiveDelta / 2).toArray()
        .map(value => THREE.MathUtils.clamp(roundInteger(value), -10000, 10000));
      if (part.type === 'box') {
        const size = [...part.size]; size[axis] = extent;
        transform = { position, size };
        dimensions = { size };
        mesh.scale.set(size[0] / part.size[0], size[1] / part.size[1], size[2] / part.size[2]);
      } else {
        transform = { position, height: extent };
        dimensions = { radius: part.radius, height: extent };
        mesh.scale.set(1, extent / part.height, 1);
      }
      mesh.position.fromArray(position);
    }
    updateHandleLayout(dimensions);
    drag.transform = transform;
    onTransformPreview(part.id, transform);
    render();
  }
  function finishResizeDrag(event, commit) {
    const drag = resizeDrag;
    if (!drag || (event && drag.pointerId !== event.pointerId)) return;
    resizeDrag = null;
    controls.enabled = true;
    if (renderer.domElement.hasPointerCapture(drag.pointerId)) renderer.domElement.releasePointerCapture(drag.pointerId);
    if (commit && !sameTransform(drag.transform, originalResizeTransform(drag))) onTransformCommit(drag.part.id, drag.transform);
    else {
      drag.mesh.position.fromArray(drag.part.position);
      drag.mesh.scale.set(1, 1, 1);
      onTransformPreview(drag.part.id, originalResizeTransform(drag));
      updateHandleLayout(drag.part.type === 'box' ? { size: drag.part.size } : { radius: drag.part.radius, height: drag.part.height });
      render();
    }
  }
  renderer.domElement.addEventListener('pointerdown', event => {
    if (mode !== 'resize' || event.button !== 0 || !selectedMesh || !resizeHandles.length) return;
    setRayFromEvent(event);
    scene.updateMatrixWorld(true);
    const handle = raycaster.intersectObjects(resizeHandles, false)[0]?.object;
    if (!handle) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const { axis, sign } = handle.userData;
    const worldAxis = axisVectors[axis].clone().applyQuaternion(selectedMesh.quaternion).normalize();
    const planeNormal = new THREE.Vector3();
    camera.getWorldDirection(planeNormal);
    planeNormal.addScaledVector(worldAxis, -planeNormal.dot(worldAxis));
    if (planeNormal.lengthSq() < 1e-6) planeNormal.copy(camera.up).applyQuaternion(camera.quaternion).addScaledVector(worldAxis, -camera.up.clone().applyQuaternion(camera.quaternion).dot(worldAxis));
    if (planeNormal.lengthSq() < 1e-6) planeNormal.crossVectors(worldAxis, new THREE.Vector3(1, 0, 0));
    planeNormal.normalize();
    const center = handle.getWorldPosition(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, center);
    const initialPoint = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!initialPoint) return;
    renderer.domElement.setPointerCapture(event.pointerId);
    controls.enabled = false;
    resizeDrag = { pointerId: event.pointerId, axis, sign, part: structuredClone(selectedPart), mesh: selectedMesh, worldAxis, plane, initialPoint, snappedDelta: 0, transform: null };
    resizeDrag.transform = originalResizeTransform(resizeDrag);
  }, true);
  renderer.domElement.addEventListener('pointermove', event => {
    if (!resizeDrag || resizeDrag.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    setRayFromEvent(event);
    const point = raycaster.ray.intersectPlane(resizeDrag.plane, new THREE.Vector3());
    if (!point) return;
    const delta = point.sub(resizeDrag.initialPoint).dot(resizeDrag.worldAxis);
    const snappedDelta = Math.round(delta / currentGrid) * currentGrid;
    if (snappedDelta === resizeDrag.snappedDelta) return;
    resizeDrag.snappedDelta = snappedDelta;
    applyResizePreview(resizeDrag, snappedDelta);
  }, true);
  renderer.domElement.addEventListener('pointerup', event => {
    if (!resizeDrag || resizeDrag.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    finishResizeDrag(event, true);
  }, true);
  renderer.domElement.addEventListener('pointercancel', event => {
    if (!resizeDrag || resizeDrag.pointerId !== event.pointerId) return;
    event.stopImmediatePropagation();
    finishResizeDrag(event, false);
  }, true);
  renderer.domElement.addEventListener('lostpointercapture', event => {
    if (resizeDrag?.pointerId === event.pointerId) finishResizeDrag(null, false);
  });
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
    setRayFromEvent(event);
    onSelect(raycaster.intersectObjects(pickable, false)[0]?.object.userData.partId ?? null);
  });
  return {
    rebuild,
    setMode(nextMode) {
      if (!['translate', 'rotate', 'resize'].includes(nextMode)) return;
      finishResizeDrag(null, false);
      mode = nextMode;
      if (nextMode === 'resize') {
        transformControls.detach();
        if (selectedMesh && !handleGroup) createResizeHandles(selectedPart, selectedMesh);
      }
      else {
        transformControls.setMode(nextMode);
        if (selectedMesh) transformControls.attach(selectedMesh);
      }
      if (handleGroup) handleGroup.visible = nextMode === 'resize';
      render();
    },
  };
}
