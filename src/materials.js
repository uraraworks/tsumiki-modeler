import * as THREE from 'three';
export function createToonMaterial(color, light, ambient, map = null) {
  return new THREE.ShaderMaterial({
    uniforms: { baseColor: { value: new THREE.Color(color) }, colorMap: { value: map }, useMap: { value: !!map }, lightDirection: { value: light.position.clone().normalize() }, ambientStrength: { value: ambient.intensity }, lightStrength: { value: light.intensity } },
    vertexShader: `
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 baseColor;
      uniform sampler2D colorMap;
      uniform bool useMap;
      uniform vec3 lightDirection;
      uniform float ambientStrength;
      uniform float lightStrength;
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        vec3 direction = normalize((viewMatrix * vec4(lightDirection, 0.0)).xyz);
        float nDotL = max(dot(normalize(vNormal), direction), 0.0);
        float band = nDotL > 0.65 ? 0.82 : (nDotL > 0.2 ? 0.55 : 0.28);
        vec4 textureColor = useMap ? texture2D(colorMap, vUv) : vec4(baseColor, 1.0);
        gl_FragColor = vec4(textureColor.rgb * min(ambientStrength + band * lightStrength, 1.0), textureColor.a);
        #include <colorspace_fragment>
      }`,
  });
}
export function createOutlineMaterial(selected = false) {
  return new THREE.ShaderMaterial({
    uniforms: {
      outlineWidth: { value: selected ? 2.0 : 1.0 },
      resolution: { value: new THREE.Vector2(384, 216) },
      outlineColor: { value: new THREE.Color(selected ? '#ffd074' : '#11151c') },
    },
    vertexShader: `
      uniform float outlineWidth;
      uniform vec2 resolution;
      void main() {
        vec3 viewNormal = normalize(normalMatrix * normal);
        vec2 offset = (projectionMatrix * vec4(viewNormal, 0.0)).xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        // 正面を向く法線ではゼロベクトルの正規化を避ける。
        if (dot(offset, offset) > 0.000001) {
          gl_Position.xy += normalize(offset) * outlineWidth * 2.0 / resolution * gl_Position.w;
        }
      }`,
    fragmentShader: `
      uniform vec3 outlineColor;
      void main() {
        gl_FragColor = vec4(outlineColor, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: true,
  });
}

export function createEdgeCompositeMaterial(colorTexture, normalTexture, depthTexture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      colorTexture: { value: colorTexture },
      normalTexture: { value: normalTexture },
      depthTexture: { value: depthTexture },
      texelSize: { value: new THREE.Vector2(1 / 384, 1 / 216) },
      cameraNear: { value: 0.1 },
      cameraFar: { value: 100000 },
      depthThreshold: { value: 0.06 },
      normalThreshold: { value: 0.2 },
      edgeColor: { value: new THREE.Color('#11151c') },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: `
      #include <packing>
      uniform sampler2D colorTexture;
      uniform sampler2D normalTexture;
      uniform sampler2D depthTexture;
      uniform vec2 texelSize;
      uniform float cameraNear;
      uniform float cameraFar;
      uniform float depthThreshold;
      uniform float normalThreshold;
      uniform vec3 edgeColor;
      varying vec2 vUv;

      bool occupied(vec2 uv) {
        return texture2D(normalTexture, uv).a > 0.5;
      }
      float viewDistance(vec2 uv) {
        float depth = texture2D(depthTexture, uv).x;
        return abs(perspectiveDepthToViewZ(depth, cameraNear, cameraFar));
      }
      bool internalEdge(vec2 uv, vec2 neighborUv) {
        vec4 centerSample = texture2D(normalTexture, uv);
        vec4 neighborSample = texture2D(normalTexture, neighborUv);
        if (centerSample.a < 0.5 || neighborSample.a < 0.5) return false;
        float centerDepth = viewDistance(uv);
        float neighborDepth = viewDistance(neighborUv);
        float relativeDepthDifference = abs(centerDepth - neighborDepth) / max(min(centerDepth, neighborDepth), 1.0);
        vec3 centerNormal = normalize(centerSample.rgb * 2.0 - 1.0);
        vec3 neighborNormal = normalize(neighborSample.rgb * 2.0 - 1.0);
        return relativeDepthDifference > depthThreshold
          || 1.0 - dot(centerNormal, neighborNormal) > normalThreshold;
      }
      void main() {
        vec2 leftUv = max(vUv - vec2(texelSize.x, 0.0), vec2(0.0));
        vec2 upUv = max(vUv - vec2(0.0, texelSize.y), vec2(0.0));
        vec2 rightUv = min(vUv + vec2(texelSize.x, 0.0), vec2(1.0));
        vec2 downUv = min(vUv + vec2(0.0, texelSize.y), vec2(1.0));
        bool centerOccupied = occupied(vUv);
        bool silhouette = centerOccupied && (!occupied(leftUv) || !occupied(upUv) || !occupied(rightUv) || !occupied(downUv));
        // 左・上との差だけを採用し、境界の両側へ線が出て2px幅になるのを防ぐ。
        bool edge = silhouette || internalEdge(vUv, leftUv) || internalEdge(vUv, upUv);
        vec4 color = texture2D(colorTexture, vUv);
        gl_FragColor = edge ? vec4(edgeColor, 1.0) : color;
        #include <colorspace_fragment>
      }`,
    depthTest: false,
    depthWrite: false,
  });
}
