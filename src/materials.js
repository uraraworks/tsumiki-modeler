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
