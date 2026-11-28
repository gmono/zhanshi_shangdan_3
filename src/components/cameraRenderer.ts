// Render YUV420p frames from the WebView2 shared buffer with WebGL.
// The frame planes are read directly from the shared memory; no per-frame
// JSON/Base64 copy happens in JS.

export interface CameraBufferMeta {
  width: number;
  height: number;
  headerBytes: number;
  slotBytes: number;
}

export interface CameraRenderer {
  dispose(): void;
}

const MAGIC = 0x53414231;

export function createCameraRenderer(
  canvas: HTMLCanvasElement,
  buffer: ArrayBuffer,
  meta: CameraBufferMeta,
  onFrame: (source: number) => void,
): CameraRenderer {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, desynchronized: true });
  if (!gl) throw new Error('WebGL 不可用');
  canvas.width = meta.width;
  canvas.height = meta.height;

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || '着色器编译失败');
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() { gl_Position = vec4(a_pos, 0.0, 1.0); v_uv = vec2((a_pos.x + 1.0) * 0.5, 1.0 - (a_pos.y + 1.0) * 0.5); }
  `));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_y;
    uniform sampler2D u_u;
    uniform sampler2D u_v;
    void main() {
      float y = texture2D(u_y, v_uv).r - 0.0625;
      float u = texture2D(u_u, v_uv).r - 0.5;
      float v = texture2D(u_v, v_uv).r - 0.5;
      vec3 rgb = mat3(1.164, 1.164, 1.164, 0.0, -0.213, 2.112, 1.793, -0.533, 0.0) * vec3(y, u, v);
      gl_FragColor = vec4(rgb, 1.0);
    }
  `));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || '着色器链接失败');
  gl.useProgram(program);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const textures = ['u_y', 'u_u', 'u_v'].map((name, index) => {
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.uniform1i(gl.getUniformLocation(program, name), index);
    return texture;
  });

  const header = new DataView(buffer);
  const lumaLength = meta.width * meta.height;
  const chromaLength = lumaLength / 4;
  let lastSequence = -1;
  let disposed = false;
  let frame = 0;

  const render = () => {
    if (disposed) return;
    const sequence = header.getUint32(16, true);
    const active = header.getUint32(20, true);
    const source = header.getUint32(28, true);
    const headerBytes = header.getUint32(32, true) || meta.headerBytes;
    const slotBytes = header.getUint32(24, true) || meta.slotBytes;
    if (sequence !== lastSequence && header.getUint32(0, true) === MAGIC && active < 2) {
      const base = headerBytes + active * slotBytes;
      const y = new Uint8Array(buffer, base, lumaLength);
      const u = new Uint8Array(buffer, base + lumaLength, chromaLength);
      const v = new Uint8Array(buffer, base + lumaLength + chromaLength, chromaLength);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textures[0]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, meta.width, meta.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, y);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, textures[1]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, meta.width / 2, meta.height / 2, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, u);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, textures[2]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, meta.width / 2, meta.height / 2, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, v);
      lastSequence = sequence;
      onFrame(source);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures[0]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textures[1]);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, textures[2]);
    gl.viewport(0, 0, meta.width, meta.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    frame = requestAnimationFrame(render);
  };
  render();

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      for (const texture of textures) gl.deleteTexture(texture);
      gl.deleteBuffer(quad);
      gl.deleteProgram(program);
    },
  };
}
