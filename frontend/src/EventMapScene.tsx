import { useLayoutEffect, useMemo, useRef } from 'react'
import { buildEventMapMesh } from './event-map-mesh'
import { cx, cy, focal, height, width } from './event-map-space'
import type { Camera } from './event-map-space'
import type { MapNode } from './types'

const vertexShader = `
  attribute vec3 position;
  attribute vec3 normal;
  attribute vec3 color;
  attribute float glow;
  uniform vec4 orbit;
  uniform vec2 center;
  uniform vec2 lens;
  varying vec3 viewNormal;
  varying vec3 viewPosition;
  varying vec3 surface;
  varying float emission;

  vec3 rotate(vec3 point) {
    float x = point.x * orbit.x - point.y * orbit.y;
    float y = point.x * orbit.y + point.y * orbit.x;
    return vec3(x, y * orbit.z - point.z * orbit.w, y * orbit.w + point.z * orbit.z);
  }
  void main() {
    vec3 view = rotate(position);
    float distance = ${focal}.0 - view.z;
    // xy and perspective divide match the SVG labels. Depth gives the solid meshes occlusion.
    gl_Position = vec4(center * distance + view.xy * lens, 1.007 * distance - 20.07, distance);
    viewNormal = rotate(normal);
    viewPosition = view;
    surface = color;
    emission = glow;
  }
`

const fragmentShader = `
  precision mediump float;
  varying vec3 viewNormal;
  varying vec3 viewPosition;
  varying vec3 surface;
  varying float emission;

  void main() {
    vec3 n = normalize(viewNormal);
    vec3 v = normalize(vec3(-viewPosition.xy, ${focal}.0 - viewPosition.z));
    vec3 key = normalize(vec3(-0.48, -0.50, 0.72));
    vec3 fill = normalize(vec3(0.64, 0.16, -0.32));
    float diffuse = max(dot(n, key), 0.0);
    float bounce = max(dot(n, fill), 0.0);
    float shine = pow(max(dot(n, normalize(key + v)), 0.0), 23.0);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    vec3 light = surface * (0.49 + 0.63 * diffuse + 0.19 * bounce + emission);
    light += vec3(0.55, 0.78, 0.92) * (0.22 * shine + rim * 0.062);
    gl_FragColor = vec4(light, 1.0);
  }
`

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  gl.deleteShader(shader)
  return null
}

function createRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true })
  if (!gl) return null
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexShader)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentShader)
  const program = gl.createProgram()
  if (!vertex || !fragment || !program) {
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
    if (program) gl.deleteProgram(program)
    return null
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  const buffer = gl.createBuffer()
  if (!buffer || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (buffer) gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
    return null
  }
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  for (const [name, size, offset] of [['position', 3, 0], ['normal', 3, 3], ['color', 3, 6], ['glow', 1, 9]] as const) {
    const location = gl.getAttribLocation(program, name)
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 40, offset * 4)
  }
  const orbit = gl.getUniformLocation(program, 'orbit')
  const center = gl.getUniformLocation(program, 'center')
  const lens = gl.getUniformLocation(program, 'lens')
  gl.enable(gl.DEPTH_TEST)
  gl.clearColor(0, 0, 0, 0)
  let loaded: Float32Array | null = null

  return {
    draw(mesh: Float32Array, camera: Camera) {
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height || gl.isContextLost()) return false
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.round(rect.width * pixelRatio), h = Math.round(rect.height * pixelRatio)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      if (loaded !== mesh) {
        gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW)
        loaded = mesh
      }
      gl.viewport(0, 0, w, h)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
      gl.uniform4f(orbit, Math.cos(camera.yaw), Math.sin(camera.yaw), Math.cos(camera.pitch), Math.sin(camera.pitch))
      gl.uniform2f(center, 2 * (cx + camera.x) / width - 1, 1 - 2 * (cy + camera.y) / height)
      gl.uniform2f(lens, 2 * focal * camera.zoom / width, -2 * focal * camera.zoom / height)
      gl.drawArrays(gl.TRIANGLES, 0, mesh.length / 10)
      return true
    },
    dispose() {
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    },
  }
}

export default function EventMapScene({ nodes, camera, onReady }: {
  nodes: MapNode[]
  camera: Camera
  onReady: (ready: boolean) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<ReturnType<typeof createRenderer>>(null)
  const redraw = useRef<(() => void) | null>(null)
  const mesh = useMemo(() => buildEventMapMesh(nodes), [nodes])

  useLayoutEffect(() => {
    const element = canvas.current
    if (!element || typeof WebGLRenderingContext === 'undefined') return
    const restore = () => {
      renderer.current = createRenderer(element)
      redraw.current?.()
    }
    const lose = (event: Event) => {
      event.preventDefault()
      renderer.current = null
      onReady(false)
    }
    restore()
    const resize = new ResizeObserver(() => redraw.current?.())
    resize.observe(element)
    element.addEventListener('webglcontextlost', lose)
    element.addEventListener('webglcontextrestored', restore)
    return () => {
      resize.disconnect()
      element.removeEventListener('webglcontextlost', lose)
      element.removeEventListener('webglcontextrestored', restore)
      renderer.current?.dispose()
      renderer.current = null
    }
  }, [onReady])

  useLayoutEffect(() => {
    const render = () => {
      if (camera.mode === 'scene') onReady(renderer.current?.draw(mesh, camera) ?? false)
    }
    redraw.current = render
    render()
    return () => { redraw.current = null }
  }, [camera, mesh, onReady])

  return <canvas className="map-solid-scene" ref={canvas} aria-hidden="true" hidden={camera.mode !== 'scene'}/>
}
