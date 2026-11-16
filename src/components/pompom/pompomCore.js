/**
 * pompomCore.js — 与框架无关的 three.js 渲染核心。
 *
 * 被 `PomPomStage.tsx`（React client component）调用；同时被
 * `scripts/record-pompom.mjs` 生成的独立预览页复用（见 docs/asset-notes.md）。
 *
 * 职责：
 *  1. three.js 原生 API 加载 FBX（FBXLoader），不依赖 @react-three/fiber；
 *  2. 用 LoadingManager.setURLModifier 把 FBX 里失效的中文贴图路径映射到
 *     public/model/textures/ 下的英文文件名（body.png / face.png），
 *     并按材质名兜底替换 FBX 内嵌贴图；
 *  3. 程序化待机：上下浮动 + 呼吸缩放 + 轻微摇摆 + 头部小幅摆动 + 眨眼
 *     （blendShape「まばたき」；若模型自带 AnimationClip 则优先播放动画）；
 *  4. 性能：像素比 ≤ 1.5、low-power、~40fps 节流、离屏/不可见时暂停、
 *     卸载时释放全部 GPU 资源；
 *  5. 失败时通过 onError 通知调用方降级到静态海报。
 */

export const POMPOM_MODEL_URL = "/model/PomPom.fbx";

/** public/model/textures/ 下的英文贴图名（源文件名是中文：身体.png / 表情.png）。 */
export const POMPOM_TEXTURE_URLS = Object.freeze({
  body: "/model/textures/body.png", // 源 assets/model/textures/身体.png（2048² body atlas）
  face: "/model/textures/face.png", // 源 assets/model/textures/表情.png（1181² RGBA 表情图集）
});

const TARGET_FPS = 40;
const MAX_PIXEL_RATIO = 1.5;
const TARGET_MODEL_HEIGHT = 2.0; // 归一化后的模型世界高度，取景稳定
const CAMERA_FOV = 30;

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

/**
 * @typedef {object} PomPomStageOptions
 * @property {HTMLElement} container 画布挂载点
 * @property {string} [modelUrl]
 * @property {{body?: string, face?: string}} [textureUrls]
 * @property {() => void} [onReady] 首帧渲染完成（此时 canvas 已有可见内容）
 * @property {(error: Error) => void} [onError] WebGL 不可用 / 模型加载失败
 * @property {(progress: number) => void} [onProgress] 0..1
 * @property {boolean} [reducedMotion] prefers-reduced-motion 时禁掉待机动画
 */

/**
 * @typedef {object} PomPomStageHandle
 * @property {() => void} dispose
 * @property {() => void} pause
 * @property {() => void} resume
 * @property {() => void} resize
 * @property {boolean} ready
 * @property {Error|null} error
 */

/**
 * 创建帕姆 3D 立绘舞台。同步返回句柄；异步加载失败时调用 onError。
 * @param {PomPomStageOptions} options
 * @returns {PomPomStageHandle}
 */
export function createPomPomStage(options) {
  const {
    container,
    modelUrl = POMPOM_MODEL_URL,
    textureUrls = POMPOM_TEXTURE_URLS,
    onReady,
    onError,
    onProgress,
    reducedMotion = false,
  } = options || {};

  const handle = {
    dispose,
    pause: () => {
      manualPaused = true;
      updateRunning();
    },
    resume: () => {
      manualPaused = false;
      updateRunning();
    },
    resize: () => resize(),
    /** 调试/后续表情联动：按名称（或正则）设置 blendShape 权重 0..1，返回命中的通道数。 */
    setMorph: (namePattern, value = 1) => {
      const regex = namePattern instanceof RegExp ? namePattern : new RegExp(namePattern);
      let count = 0;
      model?.traverse?.((object) => {
        if (!object || !object.isMesh || !object.morphTargetDictionary) return;
        for (const [channelName, index] of Object.entries(object.morphTargetDictionary)) {
          if (regex.test(channelName)) {
            if (object.morphTargetInfluences) object.morphTargetInfluences[index] = value;
            count += 1;
          }
        }
      });
      return count;
    },
    /** 调试：返回取景/尺寸等内部状态。 */
    getDebugInfo: () => ({
      modelHeight,
      modelWidth,
      basePivotY,
      cameraAspect: camera ? Number(camera.aspect.toFixed(4)) : null,
      cameraZ: camera ? Number(camera.position.z.toFixed(3)) : null,
      canvas: renderer?.domElement
        ? [renderer.domElement.clientWidth, renderer.domElement.clientHeight]
        : null,
      blinkChannels: blinkTargets.length,
      armsPosedDown,
      hasAnimation: !!(mixer && mixer._actions && mixer._actions.length),
    }),
    /** 调试：列出模型全部 blendShape 通道名。 */
    getMorphNames: () => {
      const names = [];
      model?.traverse?.((object) => {
        if (!object || !object.isMesh || !object.morphTargetDictionary) return;
        names.push(...Object.keys(object.morphTargetDictionary));
      });
      return names;
    },
    get ready() {
      return ready;
    },
    get error() {
      return stageError;
    },
  };

  if (!container || !isBrowser) {
    fail(new Error("pompom: 无可用容器（非浏览器环境）"));
    return handle;
  }

  // ---- 内部状态 -----------------------------------------------------------
  let disposed = false;
  let ready = false;
  let readyNotified = false;
  let stageError = null;
  let manualPaused = false;
  let inView = true;
  let pageVisible = true;
  let running = false;
  let rafId = 0;

  let three = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let pivot = null; // 承担浮动/呼吸的根节点
  let model = null;
  let mixer = null;
  let loadManager = null;

  let resizeObserver = null;
  let intersectionObserver = null;
  let shadowTexture = null;
  let shadowMesh = null;

  /** @type {Map<string, any>} */
  const textures = new Map();
  /** @type {Array<{mesh: any, index: number}>} */
  let blinkTargets = [];
  let headBone = null; // { bone, base: Quaternion }
  let modelHeight = TARGET_MODEL_HEIGHT;
  let modelWidth = TARGET_MODEL_HEIGHT * 0.62;
  let basePivotY = TARGET_MODEL_HEIGHT * 0.5;

  let armsPosedDown = 0;
  let lastRenderAt = 0;
  let startedAt = 0;
  let nextBlinkAt = 0;
  let blinkStartedAt = -1;
  let blinkDouble = false;
  const idleQuat = { value: null };
  const idleEuler = { value: null };
  const idleVec = { value: null };

  // ---- 生命周期 -----------------------------------------------------------
  function fail(error) {
    if (disposed) return;
    stageError = error instanceof Error ? error : new Error(String(error));
    // eslint-disable-next-line no-console
    console.warn("[PomPomStage] 3D 立绘不可用，降级为静态海报：", stageError.message);
    try {
      onError?.(stageError);
    } catch (_) {
      /* onError 异常不能影响降级 */
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopLoop();
    try {
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      renderer?.domElement?.removeEventListener("webglcontextlost", onContextLost);
    } catch (_) {
      /* noop */
    }
    resizeObserver = null;
    intersectionObserver = null;

    try {
      if (scene) {
        scene.traverse((obj) => {
          if (!obj || !obj.isMesh) return;
          obj.geometry?.dispose?.();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of mats) {
            if (!mat) continue;
            for (const value of Object.values(mat)) {
              if (value && value.isTexture) value.dispose?.();
            }
            mat.dispose?.();
          }
        });
      }
    } catch (_) {
      /* noop */
    }
    try {
      shadowTexture?.dispose();
      mixer?.stopAllAction?.();
      mixer = null;
      renderer?.dispose?.();
      if (renderer?.domElement?.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    } catch (_) {
      /* noop */
    }
    renderer = null;
    scene = null;
    camera = null;
    model = null;
    pivot = null;
    three = null;
    textures.clear();
    blinkTargets = [];
    headBone = null;
    idleQuat.value = null;
    idleEuler.value = null;
    idleVec.value = null;
  }

  // ---- 可见性 / 帧循环 ----------------------------------------------------
  function onVisibilityChange() {
    pageVisible = document.visibilityState !== "hidden";
    updateRunning();
  }

  function onContextLost(event) {
    event.preventDefault?.();
    fail(new Error("WebGL context lost"));
  }

  function updateRunning() {
    const shouldRun = !disposed && ready && !manualPaused && inView && pageVisible;
    if (shouldRun && !running) {
      running = true;
      startedAt = performance.now();
      lastRenderAt = 0;
      rafId = requestAnimationFrame(loop);
    } else if (!shouldRun && running) {
      stopLoop();
    }
  }

  function stopLoop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function loop(now) {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (lastRenderAt && now - lastRenderAt < 1000 / TARGET_FPS - 1.5) return;
    const dt = lastRenderAt ? Math.min(0.12, (now - lastRenderAt) / 1000) : 1 / TARGET_FPS;
    lastRenderAt = now;
    renderFrame(now, true, dt);
  }

  function renderFrame(now, animate, dt) {
    if (!renderer || !scene || !camera || disposed) return;
    if (animate && !reducedMotion) applyIdle(now, dt || 0);
    if (animate && mixer) {
      try {
        mixer.update(dt || 0);
      } catch (_) {
        /* 模型动画异常不影响静态展示 */
      }
    }
    renderer.render(scene, camera);
    if (!ready) {
      ready = true;
      if (!readyNotified) {
        readyNotified = true;
        try {
          onReady?.();
        } catch (_) {
          /* noop */
        }
      }
    }
  }

  // ---- 程序化待机 ---------------------------------------------------------
  function applyIdle(now, dt) {
    if (!pivot || !three) return;
    const t = ((now - startedAt) / 1000) % 7200; // 防长时间运行浮点精度下降
    const breathe = Math.sin((t * Math.PI * 2) / 4.2);
    pivot.position.y = basePivotY + breathe * 0.012;
    pivot.rotation.z = Math.sin((t * Math.PI * 2) / 7.6) * 0.011;
    pivot.scale.set(1 - breathe * 0.0035, 1 + breathe * 0.005, 1 - breathe * 0.0035);

    if (headBone) {
      if (!idleEuler.value) idleEuler.value = new three.Euler();
      if (!idleQuat.value) idleQuat.value = new three.Quaternion();
      idleEuler.value.set(Math.sin(t * 0.72) * 0.014, Math.sin(t * 0.53 + 1.1) * 0.02, 0, "XYZ");
      idleQuat.value.setFromEuler(idleEuler.value);
      headBone.bone.quaternion.copy(headBone.base).multiply(idleQuat.value);
    }

    applyBlink(t);
  }

  function applyBlink(t) {
    if (!blinkTargets.length) return;
    if (blinkStartedAt < 0) {
      if (nextBlinkAt === 0) nextBlinkAt = t + 2.2 + Math.random() * 2.0;
      if (t >= nextBlinkAt) {
        blinkStartedAt = t;
        blinkDouble = Math.random() < 0.22;
      } else {
        return;
      }
    }
    const elapsed = t - blinkStartedAt;
    const single = 0.15;
    const gap = 0.07;
    let influence = 0;
    if (elapsed < single) {
      influence = Math.sin((elapsed / single) * Math.PI);
    } else if (blinkDouble && elapsed < single * 2 + gap) {
      const second = (elapsed - single - gap) / single;
      if (second > 0) influence = Math.sin(second * Math.PI);
    } else {
      blinkStartedAt = -1;
      nextBlinkAt = t + 2.4 + Math.random() * 3.2;
    }
    for (const target of blinkTargets) {
      const influences = target.mesh.morphTargetInfluences;
      if (influences) influences[target.index] = influence;
    }
  }

  // ---- 尺寸 / 取景 --------------------------------------------------------
  function resize() {
    if (!renderer || !camera || disposed) return;
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(container.clientWidth || rect.width || 320));
    const height = Math.max(1, Math.round(container.clientHeight || rect.height || 480));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    frameCamera();
    if (ready) renderFrame(performance.now(), false, 0);
  }

  function frameCamera() {
    if (!camera) return;
    const aspect = camera.aspect || 1;
    const fovRad = (camera.fov * Math.PI) / 180;
    const tan = Math.tan(fovRad / 2);
    const heightDist = modelHeight / (2 * tan);
    const widthDist = modelWidth / (2 * tan * aspect);
    // 优先填满高度；容器足够宽时完整入镜，竖长栏（游戏内左栏）允许左右裁掉
    // 少量披风/帽檐——游戏内立绘本来就是这样裁的，手臂与头部保持在画面内。
    const dist = Math.max(heightDist * 1.06, widthDist * (aspect >= 0.75 ? 0.88 : 0.8));
    camera.position.set(0, basePivotY, dist);
    camera.lookAt(0, basePivotY, 0);
    camera.near = Math.max(0.05, dist * 0.02);
    camera.far = dist * 8;
    camera.updateProjectionMatrix();
  }

  // ---- 资源加载 -----------------------------------------------------------
  function resolveAssetUrl(rawUrl) {
    let decoded = rawUrl;
    try {
      decoded = decodeURIComponent(rawUrl);
    } catch (_) {
      /* 保持原样 */
    }
    const clean = decoded.split(/[?#]/)[0];
    const base = clean.split(/[\\/]/).pop() || clean;
    if (decoded.includes("身体") || /^body\.png$/i.test(base) || /(^|[^a-z])body\.png$/i.test(base)) {
      return encodeURI(textureUrls.body || POMPOM_TEXTURE_URLS.body);
    }
    if (decoded.includes("表情") || /^face\.png$/i.test(base) || /(^|[^a-z])face\.png$/i.test(base)) {
      return encodeURI(textureUrls.face || POMPOM_TEXTURE_URLS.face);
    }
    return rawUrl;
  }

  function loadTexture(THREE, url) {
    return new Promise((resolve) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        encodeURI(url),
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = Math.min(4, renderer?.capabilities?.getMaxAnisotropy?.() ?? 1);
          texture.wrapS = THREE.ClampToEdgeWrapping;
          texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.needsUpdate = true;
          resolve(texture);
        },
        undefined,
        (error) => {
          // 贴图缺失不致命：用材质颜色兜底，几何体仍然完整可见
          // eslint-disable-next-line no-console
          console.warn(`[PomPomStage] 贴图加载失败：${url}`, error);
          resolve(null);
        },
      );
    });
  }

  async function init() {
    const THREE = await import("three");
    const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
    three = THREE;
    if (disposed) return;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 50);

    // 深蓝夜色 + 金色描边的打光（docs/plan.md §7.1 视觉 token）
    scene.add(new THREE.HemisphereLight(0x9fb0ef, 0x10142e, 1.35));
    const keyLight = new THREE.DirectionalLight(0xffe4bb, 2.9);
    keyLight.position.set(1.8, 3.2, 3.4);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x8fa6ff, 1.05);
    fillLight.position.set(-3.2, 1.4, 2.2);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xd9b46a, 2.5);
    rimLight.position.set(-2.2, 2.9, -3.1);
    scene.add(rimLight);
    const rimLight2 = new THREE.DirectionalLight(0x7fd1c8, 0.55);
    rimLight2.position.set(2.6, 1.2, -2.8);
    scene.add(rimLight2);

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        stencil: false,
        powerPreference: "low-power",
      });
    } catch (error) {
      throw new Error("WebGL 不可用：" + (error && error.message ? error.message : String(error)));
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = false;
    const canvas = renderer.domElement;
    canvas.style.cssText = "display:block;width:100%;height:100%;outline:none;";
    canvas.setAttribute("aria-hidden", "true");
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    container.appendChild(canvas);
    if (disposed) {
      renderer.dispose();
      return;
    }

    // 脚底柔和投影（程序化 canvas 纹理，不发网络请求）
    shadowTexture = createShadowTexture(THREE);
    if (shadowTexture) {
      shadowMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: 0.66, depthWrite: false }),
      );
      shadowMesh.rotation.x = -Math.PI / 2;
      shadowMesh.position.y = 0.004;
      shadowMesh.renderOrder = -1;
      scene.add(shadowMesh);
    }

    // 贴图与 FBX 并行加载；setURLModifier 负责中文路径 → 英文文件名
    const textureJob = Promise.all([
      loadTexture(THREE, textureUrls.body || POMPOM_TEXTURE_URLS.body).then((t) => ["body", t]),
      loadTexture(THREE, textureUrls.face || POMPOM_TEXTURE_URLS.face).then((t) => ["face", t]),
    ]);
    const modelJob = new Promise((resolve, reject) => {
      loadManager = new THREE.LoadingManager();
      loadManager.setURLModifier(resolveAssetUrl);
      const fbxLoader = new FBXLoader(loadManager);
      fbxLoader.load(
        encodeURI(modelUrl),
        (fbx) => resolve(fbx),
        (event) => {
          if (onProgress && event && event.total) onProgress(Math.min(1, event.loaded / event.total));
        },
        (error) => reject(error instanceof Error ? error : new Error("FBX 加载失败")),
      );
    });

    const [textureEntries, fbx] = await Promise.all([textureJob, modelJob]);
    if (disposed) {
      for (const [, texture] of textureEntries) texture?.dispose?.();
      return;
    }
    for (const [key, texture] of textureEntries) {
      if (texture) textures.set(key, texture);
    }
    onProgress?.(1);

    model = fbx;
    scene.add(fbx);
    prepareModel(THREE, fbx);
    buildObservers();
    resize();
    renderFrame(performance.now(), false, 0);
    updateRunning();
  }

  function createShadowTexture(THREE) {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(0,0,0,0.5)");
    gradient.addColorStop(0.55, "rgba(0,0,0,0.24)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function buildObservers() {
    try {
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => resize());
        resizeObserver.observe(container);
      }
    } catch (_) {
      /* noop */
    }
    try {
      if (typeof IntersectionObserver !== "undefined") {
        intersectionObserver = new IntersectionObserver(
          (entries) => {
            inView = entries[0] ? entries[0].isIntersecting : true;
            updateRunning();
          },
          { threshold: 0.01 },
        );
        intersectionObserver.observe(container);
      }
    } catch (_) {
      /* noop */
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    pageVisible = document.visibilityState !== "hidden";
  }

  // ---- 模型后处理 ---------------------------------------------------------
  /** FBXLoader 会把骨骼名里的空格转成下划线（"Left arm" -> "Left_arm"），按归一化名查找。 */
  function findBone(root, canonicalName) {
    const target = canonicalName.replace(/\s+/g, "_");
    let found = null;
    root.traverse((object) => {
      if (found || !object.isBone) return;
      if (object.name.replace(/\s+/g, "_") === target) found = object;
    });
    return found;
  }
  function prepareModel(THREE, fbx) {
    fbx.updateMatrixWorld(true);

    // 1) 贴图：按材质名映射到英文贴图文件，替换 FBX 内嵌/失效贴图
    const bodyTexture = textures.get("body") || null;
    const faceTexture = textures.get("face") || null;
    let meshCount = 0;
    fbx.traverse((object) => {
      if (!object || !object.isMesh) return;
      meshCount += 1;
      object.frustumCulled = false; // 蒙皮网格包围盒不可靠，避免被误裁剪
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const isFaceMesh = /表情/.test(object.name || "");
      for (const material of materials) {
        if (!material) continue;
        const materialName = `${material.name || ""} ${object.name || ""}`;
        const isFaceMaterial = /表情|face/i.test(materialName) || isFaceMesh;
        if (isFaceMaterial && faceTexture) {
          material.map = faceTexture;
          material.transparent = true;
          material.alphaTest = 0.35;
          material.depthWrite = false;
          material.side = THREE.DoubleSide;
        } else if (bodyTexture) {
          material.map = bodyTexture;
        }
        if (!material.map) material.color?.set(isFaceMaterial ? 0xffffff : 0x8890b8);
        material.needsUpdate = true;
      }
    });
    if (meshCount === 0) throw new Error("FBX 中未找到可渲染网格");

    // 2) 绑定姿势若是 T-pose，把手臂自然放下（A-pose 保持原样；只做一次，不参与每帧）
    poseArmsDown(THREE, fbx);

    // 3) 归一化尺寸 + 居中，适配任意 FBX 单位（本模型 UnitScaleFactor=100）
    // 注意：Box3.setFromObject 用的是 bind-pose 的 geometry.boundingBox，
    // 若绑定姿势是 T-pose 而我们把手臂放下了，包围盒会偏宽导致取景过远。
    // 这里按蒙皮后的真实顶点位置算一次精确包围盒（~1 万顶点，毫秒级）。
    const bounds = computePosedBounds(THREE, fbx);
    if (!Number.isFinite(bounds.min.x) || bounds.isEmpty()) throw new Error("模型包围盒为空");
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const rawHeight = Math.max(size.y || 0.001, 0.001);
    const rawWidth = Math.max(size.x || 0.001, 0.001);
    const scale = TARGET_MODEL_HEIGHT / rawHeight;
    modelHeight = TARGET_MODEL_HEIGHT;
    modelWidth = rawWidth * scale;

    pivot = new THREE.Group();
    pivot.name = "PomPomPivot";
    basePivotY = TARGET_MODEL_HEIGHT * 0.5 + 0.015; // 脚底贴近 y=0 的投影面
    pivot.position.y = basePivotY;
    scene.add(pivot);
    fbx.scale.setScalar(scale);
    fbx.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    pivot.add(fbx);

    if (shadowMesh) {
      shadowMesh.scale.set(Math.max(0.5, modelWidth * 0.62), Math.max(0.34, modelWidth * 0.34), 1);
    }

    // 4) 头部骨骼轻微摆动的基准
    const head = findBone(fbx, "Head");
    if (head) headBone = { bone: head, base: head.quaternion.clone() };

    // 5) 眨眼：模型无 AnimationClip，靠 shape key「まばたき」
    if (!(fbx.animations && fbx.animations.length)) {
      let shapeCount = 0;
      fbx.traverse((object) => {
        if (!object || !object.isMesh || !object.morphTargetDictionary) return;
        for (const [channelName, index] of Object.entries(object.morphTargetDictionary)) {
          shapeCount += 1;
          if (/まばたき|blink/i.test(channelName)) {
            blinkTargets.push({ mesh: object, index });
            if (object.morphTargetInfluences) object.morphTargetInfluences[index] = 0;
          }
        }
      });
      // eslint-disable-next-line no-console
      console.info(
        `[PomPomStage] 模型 AnimationClip=0，使用程序化待机；BlendShape 通道 ${shapeCount} 个，眨眼通道 ${blinkTargets.length} 个`,
      );
    }
  }

  /** 按当前骨骼姿势计算真实 AABB（逐顶点蒙皮，仅加载时一次）。 */
  function computePosedBounds(THREE, fbx) {
    fbx.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const vertex = new THREE.Vector3();
    fbx.traverse((object) => {
      if (!object || !object.isMesh) return;
      const position = object.geometry?.attributes?.position;
      if (!position) return;
      const step = Math.max(1, Math.floor(position.count / 6000)); // 最多采样 6000 点/网格
      for (let i = 0; i < position.count; i += step) {
        vertex.fromBufferAttribute(position, i);
        if (object.isSkinnedMesh && object.applyBoneTransform) {
          object.applyBoneTransform(i, vertex);
          vertex.applyMatrix4(object.matrixWorld);
        } else {
          vertex.applyMatrix4(object.matrixWorld);
        }
        box.expandByPoint(vertex);
      }
    });
    return box;
  }

  /**
   * Blender 导出的绑定姿势常见为 T-pose / A-pose。检测左右手臂是否接近水平，
   * 是则绕世界 Z 轴放下手臂并给手肘一点自然弯曲。
   */
  function poseArmsDown(THREE, fbx) {
    const pairs = [
      { upper: "Left arm", elbow: "Left elbow", wrist: "Left wrist", sign: 1 },
      { upper: "Right arm", elbow: "Right elbow", wrist: "Right wrist", sign: -1 },
    ];
    const shoulderPos = new THREE.Vector3();
    const wristPos = new THREE.Vector3();
    let posed = 0;
    for (const pair of pairs) {
      const upper = findBone(fbx, pair.upper);
      const wrist = findBone(fbx, pair.wrist) || findBone(fbx, pair.elbow);
      if (!upper || !wrist) continue;
      upper.getWorldPosition(shoulderPos);
      wrist.getWorldPosition(wristPos);
      const vx = wristPos.x - shoulderPos.x;
      const vy = wristPos.y - shoulderPos.y;
      // 手臂接近水平（|dx| 明显大于 |dy|）→ 认为还没放下
      if (Math.abs(vx) < 1e-6 || Math.abs(vy) > Math.abs(vx) * 0.55) continue;
      const currentAngle = Math.atan2(vy, vx);
      const targetAngle = Math.atan2(-1, pair.sign * 0.28);
      let delta = targetAngle - currentAngle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const axis = new THREE.Vector3(0, 0, 1);
      upper.rotateOnWorldAxis(axis, delta);
      const elbow = findBone(fbx, pair.elbow);
      if (elbow) elbow.rotateOnWorldAxis(axis, pair.sign * 0.16);
      fbx.updateMatrixWorld(true);
      posed += 1;
    }
    armsPosedDown = posed;
    if (posed) {
      // eslint-disable-next-line no-console
      console.info(`[PomPomStage] 检测到绑定姿势手臂水平，已程序化放下 ${posed} 侧手臂`);
    }
  }

  // ---- 启动 ---------------------------------------------------------------
  init().catch((error) => fail(error));
  return handle;
}

export default createPomPomStage;
