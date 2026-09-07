import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createToonMaterial, createOutlineMaterial, createEdgeCompositeMaterial } from './materials.js';
import { createBlankTexture, textureLayout } from './model.js';
import { applyAtlasUV, createPartCanvasTexture, textureSignature, updatePartCanvasTexturePixel } from './texture.js';
import { createPartGeometry, resizeDimensions, resizeHandleLayout, resizePreviewScale } from './geometry.js';
export function createViewport(container, host, onSelect, onTransformCommit, onTransformPreview, paintHandlers = {}) {
  const {
    onCommitPaint = () => {}, onHoverPaint = () => {}, onSamplePaint = () => {}, onPreviewPaint = () => {},
    onSelectBone = () => {}, onBoneTransformCommit = () => {}, onBoneTransformPreview = () => {},
  } = paintHandlers;
  const clickDragThreshold = 4;
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(384, 216, false);
  renderer.setClearColor('#242e39');
  host.append(renderer.domElement);
  const modelLayer = 1;
  const colorTarget = new THREE.WebGLRenderTarget(384, 216, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: true, stencilBuffer: false,
  });
  const normalTarget = new THREE.WebGLRenderTarget(384, 216, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: true, stencilBuffer: false,
  });
  normalTarget.depthTexture = new THREE.DepthTexture(384, 216, THREE.UnsignedIntType);
  normalTarget.depthTexture.format = THREE.DepthFormat;
  normalTarget.depthTexture.minFilter = THREE.NearestFilter;
  normalTarget.depthTexture.magFilter = THREE.NearestFilter;
  const normalMaterial = new THREE.MeshNormalMaterial();
  const edgeMaterial = createEdgeCompositeMaterial(colorTarget.texture, normalTarget.texture, normalTarget.depthTexture);
  const compositeScene = new THREE.Scene();
  const compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  compositeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), edgeMaterial));
  renderer.domElement.setAttribute('aria-label', '3Dモデル。ドラッグで回転、クリックでパーツを選択');
  const activePointerIds = new Set(), endingPointerIds = new Set(), cancellingPointerIds = new Set();
  renderer.domElement.addEventListener('pointerdown', event => activePointerIds.add(event.pointerId), true);
  renderer.domElement.addEventListener('pointerup', event => {
    activePointerIds.delete(event.pointerId);
    endingPointerIds.add(event.pointerId);
    queueMicrotask(() => endingPointerIds.delete(event.pointerId));
  }, true);
  renderer.domElement.addEventListener('pointercancel', event => {
    activePointerIds.delete(event.pointerId);
    cancellingPointerIds.add(event.pointerId);
    queueMicrotask(() => cancellingPointerIds.delete(event.pointerId));
  }, true);
  const camera = new THREE.PerspectiveCamera(38, 384 / 216, 0.1, 100000);
  camera.layers.enable(modelLayer);
  camera.position.set(18, 16, 23);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 6, 0);
  controls.minDistance = 2;
  controls.maxDistance = 50000;
  controls.update();
  const defaultMouseButtons = { ...controls.mouseButtons };
  let scene, gridHelper, pickable = [], outlineMeshes = [], bonePickable = [], boneVisuals = [], boneObjects = new Map(), mode = 'translate', boneTool = 'rotate';
  let selectedMesh = null, selectedPart = null, selectedBoneObject = null, partTransformProxy = null, handleGroup = null, resizeHandles = [], resizeDrag = null, currentGrid = 1;
  let currentDoc = null, paintTool = 'pen', paintCharacter = '0', paintStroke = null, paintSampleStart = null;
  let outlineMode = 'edge';
  const textureCache = new Map();
  const clearColor = new THREE.Color();
  function renderScene(activeCamera) {
    if (outlineMode !== 'edge') {
      renderer.setRenderTarget(null);
      renderer.render(scene, activeCamera);
      return;
    }
    const oldLayerMask = activeCamera.layers.mask;
    const oldOverrideMaterial = scene.overrideMaterial;
    const oldClearColor = renderer.getClearColor(clearColor).clone();
    const oldClearAlpha = renderer.getClearAlpha();
    try {
      activeCamera.layers.set(modelLayer);
      scene.overrideMaterial = normalMaterial;
      renderer.setClearColor('#000000', 0);
      renderer.setRenderTarget(normalTarget);
      renderer.clear();
      renderer.render(scene, activeCamera);

      activeCamera.layers.mask = oldLayerMask;
      scene.overrideMaterial = oldOverrideMaterial;
      renderer.setClearColor(oldClearColor, oldClearAlpha);
      renderer.setRenderTarget(colorTarget);
      renderer.clear();
      renderer.render(scene, activeCamera);

      edgeMaterial.uniforms.cameraNear.value = activeCamera.near;
      edgeMaterial.uniforms.cameraFar.value = activeCamera.far;
      renderer.setRenderTarget(null);
      renderer.render(compositeScene, compositeCamera);
    } finally {
      activeCamera.layers.mask = oldLayerMask;
      scene.overrideMaterial = oldOverrideMaterial;
      renderer.setClearColor(oldClearColor, oldClearAlpha);
      renderer.setRenderTarget(null);
    }
  }
  function updateOutlineVisibility() {
    for (const outline of outlineMeshes) outline.visible = outlineMode === 'inverted' || outline.userData.selected;
  }
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
    for (const marker of boneVisuals.filter(object => object.userData.boneMarker)) {
      marker.getWorldPosition(handleWorldPosition);
      const worldSize = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.position.distanceTo(handleWorldPosition) * 7 / 216;
      marker.scale.setScalar(worldSize);
    }
    renderScene(camera);
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
      dragStart = object ? { id: object.userData.partId ?? object.userData.boneId, kind: object.userData.boneId ? 'bone' : 'part', mode, transform: readTransform(object, mode) } : null;
      return;
    }
    const object = transformControls.object, finished = dragStart;
    dragStart = null;
    const id = object?.userData.partId ?? object?.userData.boneId;
    if (!object || !finished || id !== finished.id) return;
    const transform = readTransform(object, finished.mode);
    if (transform.position) object.position.fromArray(transform.position);
    else object.rotation.set(...transform.rotation.map(THREE.MathUtils.degToRad));
    const key = Object.keys(transform)[0];
    if (transform[key].some((value, index) => value !== finished.transform[key][index])) {
      if (finished.kind === 'bone') onBoneTransformCommit(finished.id, transform);
      else onTransformCommit(finished.id, transform);
    }
  });
  transformControls.addEventListener('objectChange', () => {
    const object = transformControls.object;
    if (!object) return;
    const transform = readTransform(object, transformControls.getMode());
    if (object.userData.boneId) onBoneTransformPreview(object.userData.boneId, transform);
    else {
      if (selectedMesh && object === partTransformProxy) {
        if (transform.position) {
          const bindPosition = selectedPart.bone ? boneObjects.get(selectedPart.bone).userData.bindPosition : [0, 0, 0];
          selectedMesh.position.fromArray(transform.position.map((value, axis) => value - bindPosition[axis]));
        } else selectedMesh.rotation.set(...transform.rotation.map(THREE.MathUtils.degToRad));
      }
      onTransformPreview(object.userData.partId, transform);
    }
  });
  const axisVectors = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const axisColors = ['#ef5350', '#66bb6a', '#42a5f5'];
  function createResizeHandles(part, mesh) {
    handleGroup = new THREE.Group();
    mesh.getWorldPosition(handleGroup.position);
    mesh.getWorldQuaternion(handleGroup.quaternion);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const materials = axisColors.map(color => new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false }));
    for (const { position, ...spec } of resizeHandleLayout(part)) {
      const handle = new THREE.Mesh(geometry, materials[spec.axis]);
      handle.renderOrder = 1000;
      handle.userData = spec;
      handleGroup.add(handle);
      resizeHandles.push(handle);
    }
    scene.add(handleGroup);
    updateHandleLayout(resizeDimensions(part));
  }
  function updateHandleLayout(dimensions) {
    if (!handleGroup || !selectedMesh) return;
    selectedMesh.getWorldPosition(handleGroup.position);
    selectedMesh.getWorldQuaternion(handleGroup.quaternion);
    const layout = resizeHandleLayout(selectedPart, dimensions);
    resizeHandles.forEach((handle, index) => handle.position.fromArray(layout[index].position));
  }
  // 編集のたびにドキュメントから再構築し、古いGPU資源を解放する。
  function rebuild(doc, selectedId, selectedBoneId = null) {
    finishPaintStroke(null, false);
    paintSampleStart = null;
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
    const activePartIds = new Set(doc.parts.map(part => part.id));
    for (const [partId, cached] of textureCache) if (!activePartIds.has(partId)) { cached.texture.dispose(); textureCache.delete(partId); }
    currentDoc = doc;
    scene = new THREE.Scene(); pickable = []; outlineMeshes = []; bonePickable = []; boneVisuals = []; boneObjects = new Map(); resizeHandles = []; handleGroup = null; selectedMesh = null; selectedPart = null; selectedBoneObject = null; partTransformProxy = null; currentGrid = doc.grid;
    const light = new THREE.DirectionalLight('#ffffff', 1);
    light.position.set(-3, 8, 5);
    const ambient = new THREE.AmbientLight('#ffffff', 0.18);
    scene.add(light, ambient);
    gridHelper = new THREE.GridHelper(40 * doc.grid, 40, '#687988', '#3b4a57');
    scene.add(gridHelper);
    const bindPositions = new Map();
    const bindPositionFor = bone => {
      if (bindPositions.has(bone.id)) return bindPositions.get(bone.id);
      const parent = bone.parent ? bindPositionFor(doc.bones.find(candidate => candidate.id === bone.parent)) : [0, 0, 0];
      const position = bone.position.map((value, axis) => value + parent[axis]);
      bindPositions.set(bone.id, position); return position;
    };
    for (const bone of doc.bones) {
      const object = new THREE.Object3D();
      object.position.fromArray(bone.position);
      object.rotation.set(...bone.rotation.map(THREE.MathUtils.degToRad));
      object.userData = { boneId: bone.id, bindPosition: bindPositionFor(bone) };
      boneObjects.set(bone.id, object);
    }
    for (const bone of doc.bones) {
      const object = boneObjects.get(bone.id);
      (bone.parent ? boneObjects.get(bone.parent) : scene).add(object);
      const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(1),
        new THREE.MeshBasicMaterial({ color: bone.id === selectedBoneId ? '#ffe082' : '#66d9ef', depthTest: false, depthWrite: false }),
      );
      marker.renderOrder = 2000; marker.userData = { boneId: bone.id, boneMarker: true }; object.add(marker);
      bonePickable.push(marker); boneVisuals.push(marker);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3().fromArray(bone.position)]),
        new THREE.LineBasicMaterial({ color: bone.id === selectedBoneId ? '#ffe082' : '#66d9ef', depthTest: false, depthWrite: false }),
      );
      line.renderOrder = 1999; line.userData = { boneId: bone.id };
      (bone.parent ? boneObjects.get(bone.parent) : scene).add(line); boneVisuals.push(line);
      if (bone.id === selectedBoneId) selectedBoneObject = object;
    }
    for (const part of doc.parts) {
      const geometry = createPartGeometry(part, THREE);
      const hasAtlas = applyAtlasUV(geometry, part, doc.texelsPerUnit) !== null;
      const signature = hasAtlas ? textureSignature(part, doc.palette) : null;
      let cached = textureCache.get(part.id);
      if (!signature && cached) { cached.texture.dispose(); textureCache.delete(part.id); cached = null; }
      else if (signature && cached && cached.signature !== signature) { cached.texture.dispose(); textureCache.delete(part.id); cached = null; }
      if (signature && !cached) {
        cached = { signature, texture: createPartCanvasTexture(part, doc.palette) };
        textureCache.set(part.id, cached);
      }
      const mesh = new THREE.Mesh(geometry, createToonMaterial(part.color, light, ambient, cached?.texture));
      const bindPosition = part.bone ? bindPositions.get(part.bone) : [0, 0, 0];
      mesh.position.fromArray(part.position.map((value, axis) => value - bindPosition[axis]));
      mesh.rotation.set(...part.rotation.map(THREE.MathUtils.degToRad));
      mesh.userData.partId = part.id;
      mesh.layers.set(modelLayer);
      const outline = new THREE.Mesh(geometry, createOutlineMaterial(part.id === selectedId));
      outline.userData = { partId: part.id, selected: part.id === selectedId };
      mesh.add(outline); outlineMeshes.push(outline); (part.bone ? boneObjects.get(part.bone) : scene).add(mesh); pickable.push(mesh);
      if (part.id === selectedId) { selectedMesh = mesh; selectedPart = part; }
    }
    updateOutlineVisibility();
    for (const visual of boneVisuals) visual.visible = ['bone', 'animation'].includes(mode);
    if (selectedPart) {
      partTransformProxy = new THREE.Object3D();
      partTransformProxy.position.fromArray(selectedPart.position);
      partTransformProxy.rotation.set(...selectedPart.rotation.map(THREE.MathUtils.degToRad));
      partTransformProxy.userData.partId = selectedPart.id;
      scene.add(partTransformProxy);
    }
    scene.add(transformHelper);
    if (['bone', 'animation'].includes(mode) && selectedBoneObject) { transformControls.setMode(mode === 'animation' ? 'rotate' : boneTool); transformControls.attach(selectedBoneObject); }
    else if (partTransformProxy && ['translate', 'rotate'].includes(mode)) transformControls.attach(partTransformProxy);
    else transformControls.detach();
    if (selectedMesh && mode === 'resize') createResizeHandles(selectedPart, selectedMesh);
    render();
  }
  let displayScale = 0;
  const resize = () => {
    const scale = Math.max(1, Math.floor(Math.min(container.clientWidth / 384, container.clientHeight / 216)));
    document.querySelector('#resolution').textContent = `384 × 216 · ${scale}倍`;
    if (scale !== displayScale) {
      displayScale = scale;
      renderer.domElement.style.width = `${384 * displayScale}px`;
      renderer.domElement.style.height = `${216 * displayScale}px`;
      render();
    }
  };
  new ResizeObserver(resize).observe(container);
  resize();
  const raycaster = new THREE.Raycaster();
  raycaster.layers.enable(modelLayer);
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
  function replacePreviewGeometry(mesh, part) {
    const oldGeometry = mesh.geometry;
    const geometry = createPartGeometry(part, THREE);
    applyAtlasUV(geometry, part, currentDoc.texelsPerUnit);
    mesh.geometry = geometry;
    for (const child of mesh.children) if (child.geometry === oldGeometry) child.geometry = geometry;
    oldGeometry.dispose();
  }
  function originalResizeTransform(drag) {
    if (drag.part.type === 'box') return { position: [...drag.part.position], size: [...drag.part.size] };
    if (drag.part.type === 'sphere') return { radius: drag.part.radius };
    if (drag.axis === 1) return { position: [...drag.part.position], height: drag.part.height };
    if (drag.radiusEnd) return { [drag.radiusEnd === 'top' ? 'radiusTop' : 'radiusBottom']: drag.part[drag.radiusEnd === 'top' ? 'radiusTop' : 'radiusBottom'] ?? drag.part.radius };
    return { radius: drag.part.radius };
  }
  function applyResizePreview(drag, snappedDelta) {
    const { axis, sign, radiusEnd, part, mesh, worldAxis } = drag;
    let transform, dimensions;
    if (part.type === 'sphere') {
      const radius = THREE.MathUtils.clamp(part.radius + sign * snappedDelta, 1, 10000);
      transform = { radius }; dimensions = { radius };
      mesh.scale.set(...resizePreviewScale(part, dimensions));
    } else if (part.type === 'cylinder' && radiusEnd) {
      const key = radiusEnd === 'top' ? 'radiusTop' : 'radiusBottom';
      const original = part[key] ?? part.radius;
      const radius = THREE.MathUtils.clamp(original + sign * snappedDelta, 0, 10000);
      const other = radiusEnd === 'top' ? (part.radiusBottom ?? part.radius) : (part.radiusTop ?? part.radius);
      if (radius === 0 && other === 0) return;
      transform = { [key]: radius };
      dimensions = { ...resizeDimensions(part), [key]: radius };
      replacePreviewGeometry(mesh, { ...part, [key]: radius });
      mesh.scale.set(1, 1, 1);
    } else if (axis !== 1 && part.type !== 'box') {
      const radius = THREE.MathUtils.clamp(part.radius + sign * snappedDelta, 1, 10000);
      transform = { radius };
      dimensions = { ...resizeDimensions(part), radius };
      const bindPosition = part.bone ? boneObjects.get(part.bone).userData.bindPosition : [0, 0, 0];
      mesh.position.fromArray(part.position.map((value, index) => value - bindPosition[index]));
      mesh.scale.set(...resizePreviewScale(part, dimensions));
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
        mesh.scale.set(...resizePreviewScale(part, dimensions));
      } else {
        transform = { position, height: extent };
        dimensions = { ...resizeDimensions(part), height: extent };
        mesh.scale.set(...resizePreviewScale(part, dimensions));
      }
      const bindPosition = part.bone ? boneObjects.get(part.bone).userData.bindPosition : [0, 0, 0];
      mesh.position.fromArray(position.map((value, index) => value - bindPosition[index]));
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
      const bindPosition = drag.part.bone ? boneObjects.get(drag.part.bone).userData.bindPosition : [0, 0, 0];
      drag.mesh.position.fromArray(drag.part.position.map((value, index) => value - bindPosition[index]));
      drag.mesh.scale.set(1, 1, 1);
      if (drag.radiusEnd) replacePreviewGeometry(drag.mesh, drag.part);
      onTransformPreview(drag.part.id, originalResizeTransform(drag));
      updateHandleLayout(resizeDimensions(drag.part));
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
    const { axis, sign, radiusEnd } = handle.userData;
    const worldQuaternion = selectedMesh.getWorldQuaternion(new THREE.Quaternion());
    const worldAxis = axisVectors[axis].clone().applyQuaternion(worldQuaternion).normalize();
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
    resizeDrag = { pointerId: event.pointerId, axis, sign, radiusEnd, part: structuredClone(selectedPart), mesh: selectedMesh, worldAxis, plane, initialPoint, snappedDelta: 0, transform: null };
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
  const faceNameForIntersection = (part, intersection) => {
    const normal = intersection.face?.normal;
    if (!normal) return null;
    if (part.type === 'cylinder') return Math.abs(normal.y) < .999 ? 'side' : normal.y > 0 ? 'up' : 'down';
    if (part.type === 'sphere' || part.type === 'capsule') return 'surface';
    if (normal.x > .5) return 'right';
    if (normal.x < -.5) return 'left';
    if (normal.y > .5) return 'up';
    if (normal.y < -.5) return 'down';
    return normal.z > 0 ? 'front' : 'back';
  };
  function paintHit(event) {
    setRayFromEvent(event);
    const intersection = raycaster.intersectObjects(pickable, false)[0];
    if (!intersection?.uv) return null;
    const part = currentDoc.parts.find(candidate => candidate.id === intersection.object.userData.partId);
    if (!part) return null;
    const [width, height] = part.texture?.size ?? textureLayout(part, currentDoc.texelsPerUnit).size;
    return {
      part, mesh: intersection.object, face: faceNameForIntersection(part, intersection),
      x: THREE.MathUtils.clamp(Math.floor(intersection.uv.x * width), 0, width - 1),
      y: THREE.MathUtils.clamp(Math.floor((1 - intersection.uv.y) * height), 0, height - 1),
    };
  }
  const linePixels = (from, to) => {
    const pixels = [], dx = Math.abs(to.x - from.x), sx = from.x < to.x ? 1 : -1;
    const dy = -Math.abs(to.y - from.y), sy = from.y < to.y ? 1 : -1;
    let x = from.x, y = from.y, error = dx + dy;
    while (true) {
      pixels.push([x, y]);
      if (x === to.x && y === to.y) break;
      const twice = 2 * error;
      if (twice >= dy) { error += dy; x += sx; }
      if (twice <= dx) { error += dx; y += sy; }
    }
    return pixels;
  };
  function ensurePaintTexture(stroke) {
    let cached = textureCache.get(stroke.part.id);
    if (!cached) {
      cached = { signature: null, texture: createPartCanvasTexture(stroke.previewPart, currentDoc.palette) };
      textureCache.set(stroke.part.id, cached);
      stroke.mesh.material.uniforms.colorMap.value = cached.texture;
      stroke.mesh.material.uniforms.useMap.value = true;
      stroke.mesh.material.needsUpdate = true;
    }
    return cached;
  }
  function paintAt(stroke, hit) {
    const sideWidth = stroke.part.type !== 'box' ? textureLayout(stroke.part, currentDoc.texelsPerUnit).size[0] : 0;
    const continuousFace = stroke.previous?.face && stroke.previous.face === hit.face
      && !(hit.face === 'side' && Math.abs(stroke.previous.x - hit.x) > sideWidth / 2);
    const points = continuousFace ? linePixels(stroke.previous, hit) : [[hit.x, hit.y]];
    const cached = ensurePaintTexture(stroke);
    const changed = [];
    for (const [x, y] of points) {
      if (stroke.previewPart.texture.rows[y][x] === stroke.character) continue;
      stroke.previewPart.texture.rows[y] = `${stroke.previewPart.texture.rows[y].slice(0, x)}${stroke.character}${stroke.previewPart.texture.rows[y].slice(x + 1)}`;
      stroke.pixels.set(`${x},${y}`, [x, y, stroke.character]);
      updatePartCanvasTexturePixel(cached.texture, stroke.previewPart, currentDoc.palette, x, y, stroke.character);
      changed.push([x, y, stroke.character]);
    }
    stroke.previous = { x: hit.x, y: hit.y, face: hit.face };
    if (changed.length) { onPreviewPaint(stroke.part.id, changed); render(); }
  }
  function finishPaintStroke(event, commit) {
    const stroke = paintStroke;
    if (!stroke || (event && stroke.pointerId !== event.pointerId)) return;
    paintStroke = null;
    if (renderer.domElement.hasPointerCapture(stroke.pointerId)) renderer.domElement.releasePointerCapture(stroke.pointerId);
    const cached = textureCache.get(stroke.part.id);
    if (commit && stroke.pixels.size) {
      if (cached) cached.signature = textureSignature(stroke.previewPart, currentDoc.palette);
      onCommitPaint({ type: 'paintPixels', partId: stroke.part.id, pixels: [...stroke.pixels.values()] });
    } else if (cached && (stroke.pixels.size || !stroke.part.texture)) {
      cached.texture.dispose();
      if (stroke.part.texture) {
        cached.texture = createPartCanvasTexture(stroke.part, currentDoc.palette);
        cached.signature = textureSignature(stroke.part, currentDoc.palette);
        stroke.mesh.material.uniforms.colorMap.value = cached.texture;
        stroke.mesh.material.uniforms.useMap.value = true;
      } else {
        textureCache.delete(stroke.part.id);
        stroke.mesh.material.uniforms.colorMap.value = null;
        stroke.mesh.material.uniforms.useMap.value = false;
      }
    }
    render();
  }
  renderer.domElement.addEventListener('pointerdown', event => {
    if (mode !== 'paint' || event.button !== 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const hit = paintHit(event);
    if (!hit) return;
    const effectiveTool = event.altKey ? 'eyedropper' : paintTool;
    if (effectiveTool === 'eyedropper') {
      onSamplePaint(hit.part.id, hit.part.texture?.rows[hit.y][hit.x] ?? '.');
      return;
    }
    renderer.domElement.setPointerCapture(event.pointerId);
    const previewPart = structuredClone(hit.part);
    if (!previewPart.texture) previewPart.texture = createBlankTexture(previewPart, currentDoc.texelsPerUnit);
    paintStroke = { pointerId: event.pointerId, part: hit.part, mesh: hit.mesh, previewPart, character: effectiveTool === 'eraser' ? '.' : paintCharacter, pixels: new Map(), previous: null };
    paintAt(paintStroke, hit);
  }, true);
  renderer.domElement.addEventListener('pointermove', event => {
    if (mode !== 'paint') return;
    const hit = paintHit(event);
    onHoverPaint(hit ? { partId: hit.part.id, x: hit.x, y: hit.y } : null);
    if (!paintStroke || paintStroke.pointerId !== event.pointerId) {
      if (paintStroke) paintStroke.previous = null;
      return;
    }
    event.preventDefault(); event.stopImmediatePropagation();
    if (!hit || hit.part.id !== paintStroke.part.id) { paintStroke.previous = null; return; }
    paintAt(paintStroke, hit);
  }, true);
  renderer.domElement.addEventListener('pointerup', event => {
    if (!paintStroke || paintStroke.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation(); finishPaintStroke(event, true);
  }, true);
  renderer.domElement.addEventListener('pointerleave', () => { if (mode === 'paint' && !paintStroke) onHoverPaint(null); });
  renderer.domElement.addEventListener('pointerdown', event => {
    if (mode !== 'paint' || event.button !== 2) return;
    paintSampleStart = { x: event.clientX, y: event.clientY, id: event.pointerId, dragged: false };
  });
  renderer.domElement.addEventListener('pointermove', event => {
    if (paintSampleStart && Math.hypot(event.clientX - paintSampleStart.x, event.clientY - paintSampleStart.y) > clickDragThreshold) paintSampleStart.dragged = true;
  });
  renderer.domElement.addEventListener('pointerup', event => {
    const down = paintSampleStart;
    if (!down || down.id !== event.pointerId) return;
    paintSampleStart = null;
    if (mode !== 'paint' || down.dragged || Math.hypot(event.clientX - down.x, event.clientY - down.y) > clickDragThreshold) return;
    const hit = paintHit(event);
    if (hit) onSamplePaint(hit.part.id, hit.part.texture?.rows[hit.y][hit.x] ?? '.');
  });
  // 3Dビューでは全モードで右ボタンを操作に使うため、ブラウザメニューは表示しない。
  renderer.domElement.addEventListener('contextmenu', event => event.preventDefault(), true);
  let start = null;
  renderer.domElement.addEventListener('pointerdown', event => {
    // TransformControls のリスナーが先に動くため、ギズモを掴んだクリックは選択判定に回さない。
    start = event.button === 0 && !transformControls.dragging ? { x: event.clientX, y: event.clientY, id: event.pointerId, dragged: false } : null;
  });
  renderer.domElement.addEventListener('pointermove', event => { if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > clickDragThreshold) start.dragged = true; });
  renderer.domElement.addEventListener('pointerup', event => {
    const down = start; start = null;
    if (!down || down.id !== event.pointerId || down.dragged || Math.hypot(event.clientX - down.x, event.clientY - down.y) > clickDragThreshold) return;
    setRayFromEvent(event);
    if (['bone', 'animation'].includes(mode)) {
      const hit = raycaster.intersectObjects(bonePickable, false)[0];
      if (hit) { onSelectBone(hit.object.userData.boneId); return; }
    }
    onSelect(raycaster.intersectObjects(pickable, false)[0]?.object.userData.partId ?? null);
  });
  function resetTransformDrag() {
    // 中断したギズモ操作は開始位置へ戻し、内部の軸・ドラッグ状態も解放する。
    if (transformControls.dragging) transformControls.reset();
    renderer.domElement.removeEventListener('pointermove', transformControls._onPointerMove);
    transformControls.pointerUp({ button: 0 });
    dragStart = null;
    controls.enabled = true;
  }
  function resetInteractions(event = null) {
    start = null;
    paintSampleStart = null;
    finishResizeDrag(event, false);
    // ストローク中断までに描いた内容は、通常のpointerupと同様に履歴へ確定する。
    finishPaintStroke(event, true);
    resetTransformDrag();
    controls.enabled = true;
  }
  renderer.domElement.addEventListener('pointercancel', resetInteractions);
  renderer.domElement.addEventListener('lostpointercapture', event => {
    if (!endingPointerIds.has(event.pointerId) && !cancellingPointerIds.has(event.pointerId)) {
      // OrbitControlsにもpointercancelを届け、内部のpointer配列とmoveリスナーを解放する。
      renderer.domElement.dispatchEvent(new PointerEvent('pointercancel', { pointerId: event.pointerId, bubbles: true }));
    }
    activePointerIds.delete(event.pointerId);
  });
  window.addEventListener('blur', () => {
    for (const pointerId of [...activePointerIds]) {
      renderer.domElement.dispatchEvent(new PointerEvent('pointercancel', { pointerId, bubbles: true }));
    }
    resetInteractions();
  });
  return {
    rebuild,
    setMode(nextMode) {
      if (!['translate', 'rotate', 'resize', 'paint', 'bone', 'animation'].includes(nextMode)) return;
      finishResizeDrag(null, false);
      finishPaintStroke(null, false);
      paintSampleStart = null;
      mode = nextMode;
      controls.mouseButtons = nextMode === 'paint'
        ? { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
        : { ...defaultMouseButtons };
      renderer.domElement.classList.toggle('paint-mode', nextMode === 'paint');
      for (const visual of boneVisuals) visual.visible = ['bone', 'animation'].includes(nextMode);
      if (nextMode === 'resize') {
        transformControls.detach();
        if (selectedMesh && !handleGroup) createResizeHandles(selectedPart, selectedMesh);
      }
      else if (nextMode === 'paint') transformControls.detach();
      else if (['bone', 'animation'].includes(nextMode)) {
        transformControls.setMode(nextMode === 'animation' ? 'rotate' : boneTool);
        if (selectedBoneObject) transformControls.attach(selectedBoneObject); else transformControls.detach();
      }
      else {
        transformControls.setMode(nextMode);
        if (partTransformProxy) transformControls.attach(partTransformProxy);
      }
      if (handleGroup) handleGroup.visible = nextMode === 'resize';
      render();
    },
    setBoneTool(nextTool) {
      if (!['translate', 'rotate'].includes(nextTool)) return;
      boneTool = nextTool;
      if (mode === 'bone') {
        transformControls.setMode(boneTool);
        if (selectedBoneObject) transformControls.attach(selectedBoneObject);
        render();
      }
    },
    setPaintSettings(tool, character) {
      if (['pen', 'eraser', 'eyedropper'].includes(tool)) paintTool = tool;
      if (typeof character === 'string' && character.length === 1) paintCharacter = character;
    },
    updateBonePose(nextDoc) {
      currentDoc = nextDoc;
      for (const bone of nextDoc.bones) {
        const object = boneObjects.get(bone.id);
        if (object) object.rotation.set(...bone.rotation.map(THREE.MathUtils.degToRad));
      }
      render();
    },
    setEditingEnabled(enabled) {
      if (!enabled) resetTransformDrag();
      transformControls.enabled = enabled;
      render();
    },
    renderPreview(cameraOptions = {}, previewDoc = null) {
      if (!scene) throw new Error('3D表示が初期化されていません。');
      const oldRotations = new Map([...boneObjects].map(([id, object]) => [id, object.rotation.clone()]));
      const helperVisible = transformHelper.visible;
      const gridVisible = gridHelper.visible;
      const handlesVisible = handleGroup?.visible;
      const boneVisibility = boneVisuals.map(object => object.visible);
      try {
        if (previewDoc) for (const bone of previewDoc.bones) {
          const object = boneObjects.get(bone.id);
          if (object) object.rotation.set(...bone.rotation.map(THREE.MathUtils.degToRad));
        }
        scene.updateMatrixWorld(true);
        const bounds = new THREE.Box3();
        for (const object of pickable) bounds.expandByObject(object);
        const target = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
        const presets = {
          front: [0, 0], side: [90, 0], back: [180, 0], top: [0, 90], iso: [38, 28],
        };
        const preset = presets[cameraOptions.camera ?? cameraOptions.preset ?? 'iso'] ?? presets.iso;
        const azimuth = THREE.MathUtils.degToRad(cameraOptions.azimuth ?? preset[0]);
        const elevation = THREE.MathUtils.degToRad(cameraOptions.elevation ?? preset[1]);
        if (![azimuth, elevation].every(Number.isFinite)) throw new Error('カメラの方位角・仰角を確認してください。');
        const direction = new THREE.Vector3(
          Math.sin(azimuth) * Math.cos(elevation),
          Math.sin(elevation),
          Math.cos(azimuth) * Math.cos(elevation),
        );
        const previewCamera = new THREE.PerspectiveCamera(camera.fov, 384 / 216, camera.near, camera.far);
        previewCamera.layers.enable(modelLayer);
        if (Math.abs(direction.y) > .9999) previewCamera.up.set(0, 0, direction.y > 0 ? -1 : 1);
        previewCamera.position.copy(target).add(direction);
        previewCamera.lookAt(target);
        previewCamera.updateMatrixWorld(true);
        let distance = cameraOptions.distance;
        if (distance === undefined) {
          if (cameraOptions.fit === false || bounds.isEmpty()) distance = 30;
          else {
            const inverseRotation = previewCamera.quaternion.clone().invert();
            const tanY = Math.tan(THREE.MathUtils.degToRad(previewCamera.fov / 2)) / 1.1;
            const tanX = tanY * previewCamera.aspect;
            distance = 2;
            for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
              const point = new THREE.Vector3(x, y, z).sub(target).applyQuaternion(inverseRotation);
              distance = Math.max(distance, point.z + Math.abs(point.x) / tanX, point.z + Math.abs(point.y) / tanY);
            }
          }
        }
        if (!Number.isFinite(distance) || distance <= 0) throw new Error('カメラ距離は正数で指定してください。');
        previewCamera.position.copy(target).addScaledVector(direction, distance);
        previewCamera.lookAt(target);
        previewCamera.updateMatrixWorld(true);
        transformHelper.visible = false;
        gridHelper.visible = false;
        if (handleGroup) handleGroup.visible = false;
        boneVisuals.forEach(object => { object.visible = false; });
        renderScene(previewCamera);
        return renderer.domElement.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
      } finally {
        for (const [id, rotation] of oldRotations) boneObjects.get(id)?.rotation.copy(rotation);
        transformHelper.visible = helperVisible;
        gridHelper.visible = gridVisible;
        if (handleGroup) handleGroup.visible = handlesVisible;
        boneVisuals.forEach((object, index) => { object.visible = boneVisibility[index]; });
        render();
      }
    },
    setOutlineSettings(settings = {}) {
      if (['edge', 'inverted', 'none'].includes(settings.mode)) outlineMode = settings.mode;
      if (Number.isFinite(settings.depthThreshold)) edgeMaterial.uniforms.depthThreshold.value = THREE.MathUtils.clamp(settings.depthThreshold, 0, 1);
      if (Number.isFinite(settings.normalThreshold)) edgeMaterial.uniforms.normalThreshold.value = THREE.MathUtils.clamp(settings.normalThreshold, 0, 2);
      updateOutlineVisibility();
      render();
    },
  };
}
