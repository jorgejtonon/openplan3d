import * as THREE from 'three';
import { injectPanoramaXmp, panoramaSize } from './panoramaXmp';

const VERTEX = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Equirectangular projection of the cube map, with the viewer's filmic tone mapping and sRGB
// encoding done here because render targets receive linear colour.
const FRAGMENT = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform samplerCube cubeMap;
uniform float yaw;
uniform float exposure;
const float PI = 3.141592653589793;
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color) {
  const mat3 inputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= exposure / 0.6;
  color = inputMat * color;
  color = RRTAndODTFit(color);
  color = outputMat * color;
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}
void main() {
  // Moving right across the image turns right (clockwise seen from above).
  float lon = yaw - (vUv.x - 0.5) * 2.0 * PI;
  float lat = (vUv.y - 0.5) * PI;
  vec3 dir = vec3(-cos(lat) * sin(lon), sin(lat), -cos(lat) * cos(lon));
  vec3 color = textureCube(cubeMap, dir).rgb;
  gl_FragColor = vec4(toSRGB(aces(color)), 1.0);
}
`;

export interface PanoramaOptions {
  /** Eye position, scene units (cm). */
  position: { x: number; y: number; z: number };
  /** Heading at the image centre, radians (0 = -Z). */
  yaw: number;
  exposure?: number;
  quality?: number;
}

/** Renders a 360° equirectangular JPEG from a point in the scene, tagged as a Photo Sphere. */
export async function renderPanoramaJPEG(renderer: THREE.WebGLRenderer, scene: THREE.Scene, options: PanoramaOptions): Promise<Blob> {
  const { width, height } = panoramaSize(renderer.capabilities.maxTextureSize);
  const faceSize = Math.min(renderer.capabilities.maxCubemapSize || 2048, width / 4);
  const hdr = renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float');
  const cubeTarget = new THREE.WebGLCubeRenderTarget(faceSize, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, generateMipmaps: false });
  const cubeCamera = new THREE.CubeCamera(5, 50000, cubeTarget);
  cubeCamera.position.set(options.position.x, options.position.y, options.position.z);
  scene.add(cubeCamera);
  const output = new THREE.WebGLRenderTarget(width, height, { type: THREE.UnsignedByteType, depthBuffer: false });
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT, depthTest: false, depthWrite: false,
    uniforms: { cubeMap: { value: cubeTarget.texture }, yaw: { value: options.yaw }, exposure: { value: options.exposure ?? renderer.toneMappingExposure ?? 1 } },
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const previousTarget = renderer.getRenderTarget();
  const previousXr = renderer.xr.enabled;
  renderer.xr.enabled = false;
  try {
    cubeCamera.update(renderer, scene);
    renderer.setRenderTarget(output);
    renderer.render(quadScene, quadCamera);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(output, 0, 0, width, height, pixels);
    // WebGL rows run bottom-up; images run top-down.
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas unavailable');
    const image = context.createImageData(width, height);
    const row = width * 4;
    for (let y = 0; y < height; y++) image.data.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    context.putImageData(image, 0, 0);
    const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('JPEG encoding failed')), 'image/jpeg', options.quality ?? 0.92));
    const tagged = injectPanoramaXmp(new Uint8Array(await jpeg.arrayBuffer()), width, height);
    return new Blob([tagged as BlobPart], { type: 'image/jpeg' });
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.xr.enabled = previousXr;
    scene.remove(cubeCamera);
    cubeTarget.dispose();
    output.dispose();
    material.dispose();
    quad.geometry.dispose();
  }
}
