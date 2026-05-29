import { clamp, maxPointAgeMs } from "../../shared/config.js";
import type { TrailConfig } from "../../shared/types.js";
import type { TrailEffectPlugin, TrailPoint } from "./types.js";

export type TrailRenderer = {
  resize: (width: number, height: number, pixelRatio?: number) => void;
  clear: () => void;
  draw: (points: TrailPoint[], config: TrailConfig, effect: TrailEffectPlugin) => void;
};

type ParsedColor = { r: number; g: number; b: number };

const WEBGL_PIXEL_RATIO_LIMIT = 1.15;
const CANVAS_PIXEL_RATIO_LIMIT = 1.25;
const FLOATS_PER_RIBBON_VERTEX = 4;
const FLOATS_PER_POINT_VERTEX = 4;

export function createTrailRenderer(canvas: HTMLCanvasElement): TrailRenderer {
  const webgl = createWebGlRenderer(canvas);
  if (webgl) {
    return webgl;
  }

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    throw new Error("Canvas 2D or WebGL is required for cursor trail rendering.");
  }

  return new CanvasTrailRenderer(canvas, ctx);
}

class CanvasTrailRenderer implements TrailRenderer {
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D
  ) {}

  resize(width: number, height: number, pixelRatio = window.devicePixelRatio): void {
    const ratio = Math.max(1, Math.min(CANVAS_PIXEL_RATIO_LIMIT, pixelRatio));
    this.canvas.width = Math.max(1, Math.round(width * ratio));
    this.canvas.height = Math.max(1, Math.round(height * ratio));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  clear(): void {
    if (typeof this.ctx.getTransform !== "function") {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    const transform = this.ctx.getTransform();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.setTransform(transform);
  }

  draw(points: TrailPoint[], config: TrailConfig, effect: TrailEffectPlugin): void {
    effect.draw(this.ctx, points, config);
  }
}

class WebGlTrailRenderer implements TrailRenderer {
  private readonly ribbonProgram: WebGLProgram;
  private readonly pointProgram: WebGLProgram;
  private readonly ribbonBuffer: WebGLBuffer;
  private readonly pointBuffer: WebGLBuffer;
  private readonly ribbonLocations: {
    position: number;
    alpha: number;
    side: number;
    resolution: WebGLUniformLocation;
    color: WebGLUniformLocation;
    edgePower: WebGLUniformLocation;
  };
  private readonly pointLocations: {
    position: number;
    size: number;
    alpha: number;
    resolution: WebGLUniformLocation;
    color: WebGLUniformLocation;
  };
  private ribbonData = new Float32Array(0);
  private pointData = new Float32Array(0);
  private viewportWidth = 1;
  private viewportHeight = 1;
  private pixelRatio = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGLRenderingContext
  ) {
    this.ribbonProgram = createProgram(gl, ribbonVertexShader, ribbonFragmentShader);
    this.pointProgram = createProgram(gl, pointVertexShader, pointFragmentShader);
    this.ribbonBuffer = createBuffer(gl);
    this.pointBuffer = createBuffer(gl);
    this.ribbonLocations = {
      position: getAttribLocation(gl, this.ribbonProgram, "a_position"),
      alpha: getAttribLocation(gl, this.ribbonProgram, "a_alpha"),
      side: getAttribLocation(gl, this.ribbonProgram, "a_side"),
      resolution: getUniformLocation(gl, this.ribbonProgram, "u_resolution"),
      color: getUniformLocation(gl, this.ribbonProgram, "u_color"),
      edgePower: getUniformLocation(gl, this.ribbonProgram, "u_edgePower")
    };
    this.pointLocations = {
      position: getAttribLocation(gl, this.pointProgram, "a_position"),
      size: getAttribLocation(gl, this.pointProgram, "a_size"),
      alpha: getAttribLocation(gl, this.pointProgram, "a_alpha"),
      resolution: getUniformLocation(gl, this.pointProgram, "u_resolution"),
      color: getUniformLocation(gl, this.pointProgram, "u_color")
    };

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

  resize(width: number, height: number, pixelRatio = window.devicePixelRatio): void {
    const ratio = Math.max(1, Math.min(WEBGL_PIXEL_RATIO_LIMIT, pixelRatio));
    this.pixelRatio = ratio;
    this.viewportWidth = Math.max(1, Math.round(width * ratio));
    this.viewportHeight = Math.max(1, Math.round(height * ratio));
    this.canvas.width = this.viewportWidth;
    this.canvas.height = this.viewportHeight;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.gl.viewport(0, 0, this.viewportWidth, this.viewportHeight);
  }

  clear(): void {
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  draw(points: TrailPoint[], config: TrailConfig): void {
    if (points.length < 2) {
      this.drawHead(points.at(-1), config, 1);
      return;
    }

    const primary = parseColor(config.color);
    const secondary = parseColor(config.secondaryColor);
    switch (config.effect) {
      case "cometTail":
        this.drawRibbon(points, secondary, config.lineWidth * 1.18, config.opacity * 0.26, 1.6);
        this.drawRibbon(points, primary, config.lineWidth * 0.46, config.opacity * 0.98, 2.9);
        this.drawCometSparks(points, primary, config);
        this.drawHead(points.at(-1), config, 1.85);
        break;
      case "prismPulse":
        this.drawRibbon(points, secondary, config.lineWidth * 0.42, config.opacity * 0.36, 1.05);
        this.drawRibbon(points, primary, Math.max(1.2, config.lineWidth * 0.18), config.opacity * 0.7, 3.2);
        this.drawPulsePoints(points, primary, secondary, config);
        this.drawHead(points.at(-1), config, 0.74);
        break;
      case "inkBloom":
        this.drawRibbon(points, secondary, config.lineWidth * 1.8, config.opacity * 0.18, 1.1);
        this.drawInkBlobPoints(points, primary, secondary, config);
        this.drawHead(points.at(-1), config, 1.55);
        break;
      case "electricArc":
        this.drawRibbon(points, secondary, Math.max(1.8, config.lineWidth * 0.28), config.opacity * 0.46, 0.75);
        this.drawRibbon(points, { r: 255, g: 255, b: 255 }, Math.max(1.1, config.lineWidth * 0.1), config.opacity * 0.92, 4.1);
        this.drawElectricNodes(points, primary, secondary, config);
        this.drawHead(points.at(-1), config, 0.8);
        break;
      case "starWake":
        this.drawRibbon(points, primary, Math.max(1, config.lineWidth * 0.08), config.opacity * 0.26, 3.8);
        this.drawStarNodes(points, primary, secondary, config);
        this.drawHead(points.at(-1), config, 1.05);
        break;
      case "neonRibbon":
      default:
        this.drawRibbon(points, secondary, config.lineWidth * 4.35, config.opacity * 0.28, 1.35);
        this.drawRibbon(points, primary, config.lineWidth * 1.85, config.opacity * 0.92, 2.15);
        this.drawRibbon(points, { r: 255, g: 255, b: 255 }, Math.max(1.75, config.lineWidth * 0.2), config.opacity * 0.82, 3.4);
        this.drawHead(points.at(-1), config, 1.05);
        break;
    }
  }

  private drawRibbon(points: TrailPoint[], color: ParsedColor, width: number, alpha: number, edgePower: number): void {
    const vertexCount = points.length * 2;
    this.ensureRibbonCapacity(vertexCount);
    const maxIndex = Math.max(1, points.length - 1);

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];
      const tangentX = next.x - previous.x;
      const tangentY = next.y - previous.y;
      const tangentLength = Math.hypot(tangentX, tangentY) || 1;
      const normalX = (-tangentY / tangentLength) * this.pixelRatio;
      const normalY = (tangentX / tangentLength) * this.pixelRatio;
      const recency = pointRecency(point, index, points.length);
      const order = index / maxIndex;
      const thickness = width * this.pixelRatio * (0.16 + Math.pow(order, 0.85) * Math.pow(recency, 0.28) * 0.9);
      const vertexAlpha = clamp(alpha * (0.08 + Math.pow(recency, 1.08) * 0.98), 0, 1);
      const centerX = point.x * this.pixelRatio;
      const centerY = point.y * this.pixelRatio;
      const offset = index * 2 * FLOATS_PER_RIBBON_VERTEX;

      this.ribbonData[offset] = centerX - normalX * thickness;
      this.ribbonData[offset + 1] = centerY - normalY * thickness;
      this.ribbonData[offset + 2] = vertexAlpha;
      this.ribbonData[offset + 3] = -1;
      this.ribbonData[offset + 4] = centerX + normalX * thickness;
      this.ribbonData[offset + 5] = centerY + normalY * thickness;
      this.ribbonData[offset + 6] = vertexAlpha;
      this.ribbonData[offset + 7] = 1;
    }

    const gl = this.gl;
    gl.useProgram(this.ribbonProgram);
    gl.uniform2f(this.ribbonLocations.resolution, this.viewportWidth, this.viewportHeight);
    gl.uniform3f(this.ribbonLocations.color, color.r / 255, color.g / 255, color.b / 255);
    gl.uniform1f(this.ribbonLocations.edgePower, edgePower);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.ribbonData.subarray(0, vertexCount * FLOATS_PER_RIBBON_VERTEX), gl.STREAM_DRAW);
    gl.enableVertexAttribArray(this.ribbonLocations.position);
    gl.vertexAttribPointer(this.ribbonLocations.position, 2, gl.FLOAT, false, FLOATS_PER_RIBBON_VERTEX * 4, 0);
    gl.enableVertexAttribArray(this.ribbonLocations.alpha);
    gl.vertexAttribPointer(this.ribbonLocations.alpha, 1, gl.FLOAT, false, FLOATS_PER_RIBBON_VERTEX * 4, 8);
    gl.enableVertexAttribArray(this.ribbonLocations.side);
    gl.vertexAttribPointer(this.ribbonLocations.side, 1, gl.FLOAT, false, FLOATS_PER_RIBBON_VERTEX * 4, 12);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertexCount);
  }

  private drawCometSparks(points: TrailPoint[], color: ParsedColor, config: TrailConfig): void {
    const sparks = points.filter((point, index) => index % 3 === 0 && pointRecency(point, index, points.length) > 0.12);
    if (sparks.length === 0) {
      return;
    }

    this.drawPointCloud(sparks, color, config.lineWidth * 1.05, config.opacity * 0.72);
    this.drawPointCloud(sparks.slice(-12), { r: 255, g: 255, b: 255 }, config.lineWidth * 0.44, config.opacity * 0.84);
  }

  private drawPulsePoints(points: TrailPoint[], primary: ParsedColor, secondary: ParsedColor, config: TrailConfig): void {
    const visiblePoints = points.filter((point, index) => index % 2 === 0 && pointRecency(point, index, points.length) > 0.08);
    if (visiblePoints.length === 0) {
      return;
    }

    this.drawPointCloud(visiblePoints, primary, config.lineWidth * 3.35, config.opacity * 0.5);
    this.drawPointCloud(visiblePoints, secondary, config.lineWidth * 1.15, config.opacity * 0.5);
  }

  private drawInkBlobPoints(points: TrailPoint[], primary: ParsedColor, secondary: ParsedColor, config: TrailConfig): void {
    const blobs = points.filter((point, index) => index % 2 === 0 && pointRecency(point, index, points.length) > 0.08);
    if (blobs.length === 0) {
      return;
    }

    this.drawPointCloud(blobs, secondary, config.lineWidth * 3.4, config.opacity * 0.28);
    this.drawPointCloud(blobs, primary, config.lineWidth * 2.15, config.opacity * 0.34);
  }

  private drawElectricNodes(points: TrailPoint[], primary: ParsedColor, secondary: ParsedColor, config: TrailConfig): void {
    const nodes = points.filter((point, index) => index % 4 === 0 && pointRecency(point, index, points.length) > 0.16);
    if (nodes.length === 0) {
      return;
    }

    this.drawPointCloud(nodes, secondary, config.lineWidth * 1.35, config.opacity * 0.52);
    this.drawPointCloud(nodes.slice(-16), primary, config.lineWidth * 0.56, config.opacity * 0.8);
  }

  private drawStarNodes(points: TrailPoint[], primary: ParsedColor, secondary: ParsedColor, config: TrailConfig): void {
    const nodes = points.filter((point, index) => index % 3 === 0 && pointRecency(point, index, points.length) > 0.1);
    if (nodes.length === 0) {
      return;
    }

    this.drawPointCloud(nodes, primary, config.lineWidth * 1.55, config.opacity * 0.72);
    this.drawPointCloud(nodes.slice(-10), secondary, config.lineWidth * 2.65, config.opacity * 0.34);
    this.drawPointCloud(nodes.slice(-10), { r: 255, g: 255, b: 255 }, config.lineWidth * 0.52, config.opacity * 0.9);
  }

  private drawHead(point: TrailPoint | undefined, config: TrailConfig, scale: number): void {
    if (!point) {
      return;
    }
    this.drawPointCloud([point], parseColor(config.secondaryColor), config.lineWidth * 3.45 * scale, config.opacity * 0.42);
    this.drawPointCloud([point], parseColor(config.color), config.lineWidth * 2.25 * scale, config.opacity * 0.82);
    this.drawPointCloud([point], { r: 255, g: 255, b: 255 }, config.lineWidth * 0.9 * scale, config.opacity);
  }

  private drawPointCloud(points: TrailPoint[], color: ParsedColor, size: number, alpha: number): void {
    this.ensurePointCapacity(points.length);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const recency = pointRecency(point, index, points.length);
      const offset = index * FLOATS_PER_POINT_VERTEX;
      this.pointData[offset] = point.x * this.pixelRatio;
      this.pointData[offset + 1] = point.y * this.pixelRatio;
      this.pointData[offset + 2] = size * this.pixelRatio * (0.45 + recency * 0.55);
      this.pointData[offset + 3] = clamp(alpha * (0.12 + recency * 0.96), 0, 1);
    }

    const gl = this.gl;
    gl.useProgram(this.pointProgram);
    gl.uniform2f(this.pointLocations.resolution, this.viewportWidth, this.viewportHeight);
    gl.uniform3f(this.pointLocations.color, color.r / 255, color.g / 255, color.b / 255);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.pointData.subarray(0, points.length * FLOATS_PER_POINT_VERTEX), gl.STREAM_DRAW);
    gl.enableVertexAttribArray(this.pointLocations.position);
    gl.vertexAttribPointer(this.pointLocations.position, 2, gl.FLOAT, false, FLOATS_PER_POINT_VERTEX * 4, 0);
    gl.enableVertexAttribArray(this.pointLocations.size);
    gl.vertexAttribPointer(this.pointLocations.size, 1, gl.FLOAT, false, FLOATS_PER_POINT_VERTEX * 4, 8);
    gl.enableVertexAttribArray(this.pointLocations.alpha);
    gl.vertexAttribPointer(this.pointLocations.alpha, 1, gl.FLOAT, false, FLOATS_PER_POINT_VERTEX * 4, 12);
    gl.drawArrays(gl.POINTS, 0, points.length);
  }

  private ensureRibbonCapacity(vertexCount: number): void {
    const requiredLength = vertexCount * FLOATS_PER_RIBBON_VERTEX;
    if (this.ribbonData.length < requiredLength) {
      this.ribbonData = new Float32Array(requiredLength);
    }
  }

  private ensurePointCapacity(pointCount: number): void {
    const requiredLength = pointCount * FLOATS_PER_POINT_VERTEX;
    if (this.pointData.length < requiredLength) {
      this.pointData = new Float32Array(requiredLength);
    }
  }
}

function createWebGlRenderer(canvas: HTMLCanvasElement): WebGlTrailRenderer | undefined {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance"
  });

  if (!gl || typeof gl.createShader !== "function") {
    return undefined;
  }

  return new WebGlTrailRenderer(canvas, gl);
}

function pointRecency(point: TrailPoint, index: number, pointCount: number): number {
  const ageRecency = 1 - clamp(point.ageMs / maxPointAgeMs, 0, 1);
  const orderRecency = pointCount <= 1 ? 1 : index / (pointCount - 1);
  return clamp(Math.pow(ageRecency, 1.1) * (0.04 + Math.pow(orderRecency, 1.15) * 0.96), 0, 1);
}

function parseColor(color: string): ParsedColor {
  const hex = color.trim().replace("#", "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16)
    };
  }
  return { r: 255, g: 255, b: 255 };
}

function createBuffer(gl: WebGLRenderingContext): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) {
    throw new Error("Failed to create WebGL buffer.");
  }
  return buffer;
}

function createProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    throw new Error("Failed to create WebGL program.");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Unknown WebGL program link error.";
    gl.deleteProgram(program);
    throw new Error(message);
  }

  return program;
}

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to create WebGL shader.");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unknown WebGL shader compile error.";
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

function getAttribLocation(gl: WebGLRenderingContext, program: WebGLProgram, name: string): number {
  const location = gl.getAttribLocation(program, name);
  if (location < 0) {
    throw new Error(`Missing WebGL attribute: ${name}`);
  }
  return location;
}

function getUniformLocation(gl: WebGLRenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) {
    throw new Error(`Missing WebGL uniform: ${name}`);
  }
  return location;
}

const ribbonVertexShader = `
attribute vec2 a_position;
attribute float a_alpha;
attribute float a_side;
uniform vec2 u_resolution;
uniform float u_edgePower;
varying float v_alpha;
varying float v_side;

void main() {
  vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_alpha = a_alpha;
  v_side = a_side;
}
`;

const ribbonFragmentShader = `
precision mediump float;
uniform vec3 u_color;
uniform float u_edgePower;
varying float v_alpha;
varying float v_side;

void main() {
  float edge = pow(1.0 - smoothstep(0.18, 1.0, abs(v_side)), u_edgePower);
  gl_FragColor = vec4(u_color, v_alpha * edge);
}
`;

const pointVertexShader = `
attribute vec2 a_position;
attribute float a_size;
attribute float a_alpha;
uniform vec2 u_resolution;
varying float v_alpha;

void main() {
  vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  gl_PointSize = a_size;
  v_alpha = a_alpha;
}
`;

const pointFragmentShader = `
precision mediump float;
uniform vec3 u_color;
varying float v_alpha;

void main() {
  float distanceFromCenter = distance(gl_PointCoord, vec2(0.5));
  float alpha = smoothstep(0.5, 0.0, distanceFromCenter) * v_alpha;
  gl_FragColor = vec4(u_color, alpha);
}
`;
